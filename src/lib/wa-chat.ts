import "server-only";
import type { ChatMode, ChatState, WaConversation } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { sendWhatsApp, whatsappConfigured } from "./whatsapp";
import { explainWhatsAppError } from "./order-notify";
import { resolveProvider } from "./ai/config";
import { askAssistant, buildPrompt, customerContext } from "./ai/assistant";

/**
 * WhatsApp customer chat (spec #39–#42).
 *
 * mode:  AI     — the assistant answers the customer
 *        HUMAN  — staff answer; the AI stays silent until staff switch it back
 * state: AI_HANDLING · HUMAN_HANDLING (customer waiting on staff) ·
 *        WAITING_CUSTOMER (staff replied) · REQUIRES_ATTENTION (someone must look)
 * Every change of mode or state is written to WaHandlingEvent (and the audit log
 * for staff actions), so the handling history is always available.
 */

/** Gathers quick consecutive messages into one AI reply. */
const DEBOUNCE_MS = Number(process.env.AI_REPLY_DELAY_MS ?? 2500);
/** Per conversation, per hour — beyond this a person should look. */
const MAX_AI_REPLIES_PER_HOUR = 20;
export const REPLY_WINDOW_MS = 24 * 60 * 60_000;

type Actor = { type: "staff" | "ai" | "system"; label?: string | null };

/** Changes mode and/or state, logging the transition. No-op when nothing changes. */
export async function changeHandling(
  conversationId: string,
  to: { mode?: ChatMode; state: ChatState; reason?: string | null; handledByLabel?: string | null },
  actor: Actor,
) {
  const conv = await prisma.waConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const mode = to.mode ?? conv.mode;
  if (mode === conv.mode && to.state === conv.state && (to.reason ?? null) === (conv.attentionReason ?? null)) return conv;
  const [updated] = await prisma.$transaction([
    prisma.waConversation.update({
      where: { id: conversationId },
      data: {
        mode,
        state: to.state,
        attentionReason: to.state === "REQUIRES_ATTENTION" ? (to.reason ?? null) : null,
        ...(to.handledByLabel !== undefined ? { handledByLabel: to.handledByLabel } : {}),
      },
    }),
    prisma.waHandlingEvent.create({
      data: {
        conversationId,
        fromMode: conv.mode,
        toMode: mode,
        fromState: conv.state,
        toState: to.state,
        actorType: actor.type,
        actorLabel: actor.label ?? null,
        reason: to.reason ?? null,
      },
    }),
  ]);
  return updated;
}

type Inbound = {
  from: string;
  id: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
  reaction?: { emoji?: string };
};

function inboundBody(m: Inbound): string {
  switch (m.type) {
    case "text":
      return m.text?.body?.trim() || "";
    case "image":
    case "video":
      return m.image?.caption || m.video?.caption ? `[${m.type}] ${m.image?.caption || m.video?.caption}` : `[${m.type}]`;
    case "document":
      return `[document] ${m.document?.caption || m.document?.filename || ""}`.trim();
    case "location":
      return `[location] ${[m.location?.name, m.location?.address].filter(Boolean).join(", ") || `${m.location?.latitude},${m.location?.longitude}`}`;
    case "button":
      return m.button?.text || "[button]";
    case "interactive":
      return m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "[reply]";
    case "reaction":
      return `[reacted ${m.reaction?.emoji ?? ""}]`.trim();
    default:
      return `[${m.type || "message"}]`;
  }
}

/**
 * Stores one incoming WhatsApp message. Returns null for a redelivered message
 * (Meta retries webhooks), so it is never processed twice.
 */
export async function recordInbound(m: Inbound, profileName?: string | null) {
  if (!m?.from || !m?.id) return null;
  if (await prisma.waMessage.findUnique({ where: { waMessageId: m.id }, select: { id: true } })) return null;

  // WhatsApp's timestamp (whole seconds) is the customer's clock — right for the
  // 24-hour reply window. The thread itself is ordered by when we received the
  // message: with whole seconds, a reply sent a moment earlier would otherwise
  // sort after it and make the message look already answered.
  const sentAt = m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date();
  const receivedAt = new Date();
  const body = inboundBody(m) || "[empty message]";
  // A conversation belongs to whoever owns this number in the CRM.
  const customer = await prisma.customer.findUnique({ where: { phone: m.from }, select: { id: true } });

  const conv = await prisma.waConversation.upsert({
    where: { phone: m.from },
    create: { phone: m.from, customerId: customer?.id ?? null, profileName: profileName ?? null },
    update: { ...(profileName ? { profileName } : {}), ...(customer ? { customerId: customer.id } : {}) },
  });

  let message;
  try {
    message = await prisma.waMessage.create({
      data: { conversationId: conv.id, direction: "in", sender: "CUSTOMER", type: m.type || "text", body, waMessageId: m.id, createdAt: receivedAt },
    });
  } catch {
    return null; // the same message arrived twice at once — the other copy wins
  }

  await prisma.waConversation.update({
    where: { id: conv.id },
    data: { lastInboundAt: sentAt, lastMessageAt: receivedAt, lastPreview: body.slice(0, 140), unreadCount: { increment: 1 } },
  });

  // The customer replied: in human mode the ball is back with staff.
  if (conv.mode === "HUMAN" && conv.state === "WAITING_CUSTOMER") {
    await changeHandling(conv.id, { state: "HUMAN_HANDLING", reason: null }, { type: "system", label: "Customer replied" });
  }
  return { conversationId: conv.id, messageId: message.id, mode: conv.mode };
}

/** Sends a reply from the AI or a staff member and records it in the thread. */
export async function sendChatMessage(conv: WaConversation, body: string, sender: "AI" | "STAFF", staffLabel?: string | null) {
  const msg = await prisma.waMessage.create({
    data: { conversationId: conv.id, direction: "out", sender, staffLabel: staffLabel ?? null, body, status: "sending" },
  });
  let update: { status: string; waMessageId?: string | null; error?: string | null };
  if (!whatsappConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`\n💬  [Ela WA chat → ${conv.phone}]  ${body}\n`);
    update = { status: "failed", error: "WhatsApp is not configured on this server." };
  } else {
    const r = await sendWhatsApp(conv.phone, { type: "text", body });
    update = r.ok ? { status: "sent", waMessageId: r.messageId ?? null, error: null } : { status: "failed", error: explainWhatsAppError(r) };
  }
  const [saved] = await prisma.$transaction([
    prisma.waMessage.update({ where: { id: msg.id }, data: update }),
    prisma.waConversation.update({ where: { id: conv.id }, data: { lastMessageAt: new Date(), lastPreview: body.slice(0, 140) } }),
  ]);
  return saved;
}

/**
 * Runs after the webhook has answered Meta. Waits briefly so a burst of
 * messages gets one reply, then answers only if the conversation is still in
 * AI mode and this is still the customer's latest message.
 */
export async function aiReply(conversationId: string, triggerMessageId: string): Promise<void> {
  try {
    if (DEBOUNCE_MS > 0) await new Promise((r) => setTimeout(r, DEBOUNCE_MS));

    const conv = await prisma.waConversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.mode !== "AI") return; // staff took over meanwhile

    const latest = await prisma.waMessage.findFirst({ where: { conversationId, direction: "in" }, orderBy: { createdAt: "desc" } });
    if (!latest || latest.id !== triggerMessageId) return; // a newer message will answer
    const answered = await prisma.waMessage.findFirst({ where: { conversationId, direction: "out", createdAt: { gt: latest.createdAt } }, select: { id: true } });
    if (answered) return;

    const lastHour = await prisma.waMessage.count({ where: { conversationId, sender: "AI", createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (lastHour >= MAX_AI_REPLIES_PER_HOUR) {
      await changeHandling(conversationId, { mode: "HUMAN", state: "REQUIRES_ATTENTION", reason: "Unusually many messages in an hour — AI paused" }, { type: "system" });
      return;
    }

    const resolved = await resolveProvider();
    if (!resolved.provider) {
      await changeHandling(conversationId, { state: "REQUIRES_ATTENTION", reason: `${resolved.reason} A person needs to reply.` }, { type: "system" });
      return;
    }

    const history = (await prisma.waMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 20 })).reverse();
    const ctx = await customerContext(conv);
    const turns = await buildPrompt({
      ctx,
      phone: conv.phone,
      profileName: conv.profileName,
      history: history.map((h) => ({ sender: h.sender, body: h.body })),
      instructions: resolved.instructions,
    });

    let answer;
    try {
      answer = await askAssistant(resolved.provider, turns, latest.body);
    } catch (e) {
      await changeHandling(conversationId, { state: "REQUIRES_ATTENTION", reason: `The AI couldn't reply (${(e as Error).message.slice(0, 160)}). A person needs to reply.` }, { type: "ai", label: resolved.provider.label });
      return;
    }

    // Staff may have taken over while the model was thinking.
    const now = await prisma.waConversation.findUniqueOrThrow({ where: { id: conversationId } });
    if (now.mode !== "AI") return;

    await sendChatMessage(now, answer.reply, "AI");
    if (answer.handoff) {
      await changeHandling(conversationId, { mode: "HUMAN", state: "REQUIRES_ATTENTION", reason: answer.reason }, { type: "ai", label: resolved.provider.label });
    } else if (now.state !== "AI_HANDLING") {
      await changeHandling(conversationId, { state: "AI_HANDLING", reason: null }, { type: "ai", label: resolved.provider.label });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[wa-chat] AI reply failed:", conversationId, e);
  }
}

/** Staff take over: the AI stops answering this conversation (spec #40). */
export async function takeOver(conversationId: string, staff: { label: string }, req?: Request) {
  const conv = await changeHandling(conversationId, { mode: "HUMAN", state: "HUMAN_HANDLING", reason: null, handledByLabel: staff.label }, { type: "staff", label: staff.label });
  await audit({ actor: { type: "admin", label: staff.label }, action: "whatsapp.takeover", entityType: "conversation", entityId: conversationId, summary: `${staff.label} took over the WhatsApp chat with ${conv.phone}`, req });
  return conv;
}

/** Hand back to the AI — the only way it resumes (spec #41). History is kept. */
export async function handBackToAi(conversationId: string, staff: { label: string }, req?: Request) {
  const conv = await changeHandling(conversationId, { mode: "AI", state: "AI_HANDLING", reason: null, handledByLabel: null }, { type: "staff", label: staff.label });
  await audit({ actor: { type: "admin", label: staff.label }, action: "whatsapp.handback", entityType: "conversation", entityId: conversationId, summary: `${staff.label} switched the WhatsApp chat with ${conv.phone} back to AI`, req });
  return conv;
}

const RECEIPT_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };

/** Delivery receipts for chat replies (webhook `statuses`). */
export async function applyChatReceipt(r: { id: string; status: string; errors?: { code?: number; title?: string; message?: string }[] }): Promise<boolean> {
  const msg = await prisma.waMessage.findUnique({ where: { waMessageId: r.id } });
  if (!msg) return false;
  if (r.status === "failed") {
    const e = r.errors?.[0];
    await prisma.waMessage.update({ where: { id: msg.id }, data: { status: "failed", error: `Not delivered${e ? `: ${e.message || e.title} (${e.code})` : ""}` } });
    return true;
  }
  if ((RECEIPT_RANK[r.status] ?? -1) > (RECEIPT_RANK[msg.status ?? "sending"] ?? 0)) {
    await prisma.waMessage.update({ where: { id: msg.id }, data: { status: r.status } });
  }
  return true;
}
