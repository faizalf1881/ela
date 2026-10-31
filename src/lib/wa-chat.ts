import "server-only";
import type { ChatMode, ChatState, Prisma, WaConversation } from "@prisma/client";
import { prisma } from "./db";
import { audit } from "./audit";
import { interactiveText, markRead, sendWhatsApp, whatsappConfigured, type Interactive, type OutgoingMessage } from "./whatsapp";
import type { TemplatePreview } from "./wa-template-utils";
import { explainWhatsAppError } from "./order-notify";
import { resolveProvider } from "./ai/config";
import { askAssistant, buildPrompt, customerContext, inventedAmounts, type AssistantAnswer } from "./ai/assistant";
import { applyIntent, intentFromReply, orderingFacts, textIntent, type OrderIntent } from "./wa-order/flow";
import { withLead } from "./wa-order/messages";

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
/** Per conversation, per hour — beyond this a person should look. Ordering taps each get a reply, so this is generous. */
const MAX_AI_REPLIES_PER_HOUR = 60;
export const REPLY_WINDOW_MS = 24 * 60 * 60_000;

/** The assistant is working on a reply right now (cleared when it answers; ignored after a minute). */
export const isTyping = (c: { aiTypingAt: Date | null }) => !!c.aiTypingAt && Date.now() - c.aiTypingAt.getTime() < 60_000;

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
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string; description?: string } };
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
      data: {
        conversationId: conv.id,
        direction: "in",
        sender: "CUSTOMER",
        type: m.type || "text",
        body,
        // Which button / list row was tapped — the ordering flow acts on it.
        replyId: m.interactive?.button_reply?.id || m.interactive?.list_reply?.id || m.button?.payload || null,
        waMessageId: m.id,
        createdAt: receivedAt,
      },
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

type OutboundRecord = {
  sender: "AI" | "STAFF";
  staffLabel?: string | null;
  type: string;
  body: string;
  meta?: Prisma.InputJsonValue;
};

/** Records one outgoing message in the thread, sends it, and stores the outcome. */
async function deliver(conv: WaConversation, rec: OutboundRecord, outgoing: OutgoingMessage) {
  const msg = await prisma.waMessage.create({
    data: { conversationId: conv.id, direction: "out", sender: rec.sender, staffLabel: rec.staffLabel ?? null, type: rec.type, body: rec.body, meta: rec.meta, status: "sending" },
  });
  let update: { status: string; waMessageId?: string | null; error?: string | null };
  if (!whatsappConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`\n💬  [Ela WA chat → ${conv.phone}]  ${rec.body}\n`);
    update = { status: "failed", error: "WhatsApp is not configured on this server." };
  } else {
    const r = await sendWhatsApp(conv.phone, outgoing);
    update = r.ok ? { status: "sent", waMessageId: r.messageId ?? null, error: null } : { status: "failed", error: explainWhatsAppError(r) };
  }
  const [saved] = await prisma.$transaction([
    prisma.waMessage.update({ where: { id: msg.id }, data: update }),
    prisma.waConversation.update({
      where: { id: conv.id },
      // A reply ends the assistant's "typing…".
      data: { lastMessageAt: new Date(), lastPreview: rec.body.slice(0, 140), ...(rec.sender === "AI" ? { aiTypingAt: null } : {}) },
    }),
  ]);
  return saved;
}

/** Sends a reply from the AI or a staff member — text, or buttons / a list / a link button — and records it. */
export async function sendChatMessage(conv: WaConversation, content: string | Interactive, sender: "AI" | "STAFF", staffLabel?: string | null) {
  if (typeof content === "string") return deliver(conv, { sender, staffLabel, type: "text", body: content }, { type: "text", body: content });
  return deliver(
    conv,
    { sender, staffLabel, type: "interactive", body: interactiveText(content), meta: content as unknown as Prisma.InputJsonValue },
    { type: "interactive", message: content },
  );
}

export type PreparedTemplate = {
  template: { id: string; name: string; language: string; category: string };
  components: unknown[];
  preview: TemplatePreview;
  text: string;
};

/**
 * Sends an approved template (spec #2). Templates are the one kind of message
 * WhatsApp delivers outside the 24-hour window, so this is how staff start or
 * restart a conversation.
 */
export async function sendChatTemplate(conv: WaConversation, t: PreparedTemplate, staffLabel: string) {
  return deliver(
    conv,
    {
      sender: "STAFF",
      staffLabel,
      type: "template",
      body: t.text,
      meta: { template: t.template.name, language: t.template.language, category: t.template.category, preview: t.preview } as unknown as Prisma.InputJsonValue,
    },
    { type: "template_components", name: t.template.name, lang: t.template.language, components: t.components },
  );
}

/** The conversation for a number (created when staff message someone first), linked to the CRM. */
export async function conversationFor(phone: string) {
  const customer = await prisma.customer.findUnique({ where: { phone }, select: { id: true } });
  return prisma.waConversation.upsert({
    where: { phone },
    create: { phone, customerId: customer?.id ?? null },
    update: customer ? { customerId: customer.id } : {},
  });
}

async function lastInboundWaId(conversationId: string): Promise<string | null> {
  const last = await prisma.waMessage.findFirst({
    where: { conversationId, direction: "in", waMessageId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { waMessageId: true },
  });
  return last?.waMessageId ?? null;
}

/**
 * The customer sees blue ticks (and, with `typing`, "typing…") on their last
 * message. WhatsApp only offers this for a message they sent us.
 */
export async function sendReadReceipt(conv: WaConversation, typing = false): Promise<{ ok: boolean; error?: string }> {
  if (!whatsappConfigured()) return { ok: false, error: "WhatsApp is not configured on this server." };
  const id = await lastInboundWaId(conv.id);
  if (!id) return { ok: false, error: "There is no message from the customer to reply to yet." };
  const r = await markRead(id, typing);
  return r.ok ? { ok: true } : { ok: false, error: explainWhatsAppError(r) };
}

/**
 * Runs after the webhook has answered Meta. Waits briefly so a burst of
 * messages gets one reply, then answers only if the conversation is still in
 * AI mode and this is still the customer's latest message.
 */
export async function aiReply(conversationId: string, triggerMessageId: string): Promise<void> {
  try {
    const [first, trigger, setting] = await Promise.all([
      prisma.waConversation.findUnique({ where: { id: conversationId } }),
      prisma.waMessage.findUnique({ where: { id: triggerMessageId } }),
      prisma.storeSetting.findUnique({ where: { id: 1 }, select: { waOrderingEnabled: true } }),
    ]);
    if (!first || !trigger) return;
    const ordering = setting?.waOrderingEnabled ?? true;

    // A tap on one of our buttons or lists, or the answer to a question we just
    // asked, needs no AI: it is handled at once, every tap counting.
    if (ordering && first.mode === "AI") {
      const draft = await prisma.waOrderDraft.findUnique({ where: { conversationId }, select: { step: true } });
      const intent = intentFromReply(trigger.replyId) ?? textIntent(trigger.body, trigger.type, draft);
      if (intent) {
        await showTyping(conversationId, trigger.waMessageId);
        await runOrderIntent(conversationId, intent);
        if (first.state !== "AI_HANDLING") await changeHandling(conversationId, { state: "AI_HANDLING", reason: null }, { type: "ai", label: "Ordering assistant" });
        return;
      }
    }

    // "typing…" straight away — but only when an answer is really coming, as
    // Meta asks: AI mode with a working assistant.
    if (first.mode === "AI" && (await resolveProvider()).provider) await showTyping(conversationId, trigger.waMessageId);

    if (DEBOUNCE_MS > 0) await new Promise((r) => setTimeout(r, DEBOUNCE_MS));

    const conv = await prisma.waConversation.findUnique({ where: { id: conversationId } });
    if (!conv || conv.mode !== "AI") return stopTyping(conversationId); // staff took over meanwhile

    const latest = await prisma.waMessage.findFirst({ where: { conversationId, direction: "in" }, orderBy: { createdAt: "desc" } });
    if (!latest || latest.id !== triggerMessageId) return; // a newer message will answer
    const answered = await prisma.waMessage.findFirst({ where: { conversationId, direction: "out", createdAt: { gt: latest.createdAt } }, select: { id: true } });
    if (answered) return stopTyping(conversationId);

    const lastHour = await prisma.waMessage.count({ where: { conversationId, sender: "AI", createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (lastHour >= MAX_AI_REPLIES_PER_HOUR) {
      await stopTyping(conversationId);
      await changeHandling(conversationId, { mode: "HUMAN", state: "REQUIRES_ATTENTION", reason: "Unusually many messages in an hour — AI paused" }, { type: "system" });
      return;
    }

    const resolved = await resolveProvider();
    if (!resolved.provider) {
      await changeHandling(conversationId, { state: "REQUIRES_ATTENTION", reason: `${resolved.reason} A person needs to reply.` }, { type: "system" });
      return;
    }

    const [recent, broadcast] = await Promise.all([
      prisma.waMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 20 }),
      // A campaign message they may be replying to ("I want that offer").
      prisma.waCampaignRecipient.findFirst({
        where: { phone: conv.phone, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gt: new Date(Date.now() - 7 * 86_400_000) } },
        orderBy: { sentAt: "desc" },
        select: { body: true, sentAt: true },
      }),
    ]);
    const history = [
      ...recent.map((h) => ({ sender: h.sender, body: h.body, at: h.createdAt })),
      ...(broadcast?.body && broadcast.sentAt ? [{ sender: "AI" as const, body: `[Offer we sent you on WhatsApp] ${broadcast.body}`, at: broadcast.sentAt }] : []),
    ]
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(-20);
    const ctx = await customerContext(conv);
    const turns = await buildPrompt({
      ctx,
      phone: conv.phone,
      profileName: conv.profileName,
      history: history.map((h) => ({ sender: h.sender, body: h.body })),
      instructions: resolved.instructions,
      ordering: ordering ? await orderingFacts(conversationId) : null,
    });

    let answer: AssistantAnswer;
    try {
      answer = await askAssistant(resolved.provider, turns, latest.body);
    } catch (e) {
      await stopTyping(conversationId);
      await changeHandling(conversationId, { state: "REQUIRES_ATTENTION", reason: `The AI couldn't reply (${(e as Error).message.slice(0, 160)}). A person needs to reply.` }, { type: "ai", label: resolved.provider.label });
      return;
    }

    // Staff may have taken over while the model was thinking.
    const now = await prisma.waConversation.findUniqueOrThrow({ where: { id: conversationId } });
    if (now.mode !== "AI") return stopTyping(conversationId);

    if (answer.handoff) {
      await sendChatMessage(now, answer.reply, "AI");
      await changeHandling(conversationId, { mode: "HUMAN", state: "REQUIRES_ATTENTION", reason: answer.reason }, { type: "ai", label: resolved.provider.label });
      return;
    }

    // Never let a made-up price reach the customer (spec #9): drop the text
    // and let the menu, with its real prices, answer instead.
    const invented = inventedAmounts(answer.reply, turns[0].content, latest.body);
    if (invented.length) {
      await audit({
        actor: { type: "ai", label: resolved.provider.label },
        action: "ai.price_blocked",
        entityType: "conversation",
        entityId: conversationId,
        summary: `The AI's reply quoted a price that isn't on the menu (₹${invented.join(", ₹")}) — replaced with the live menu`,
        metadata: { reply: answer.reply, invented },
      });
      answer = { ...answer, reply: "Here's our menu with today's prices 👇", action: answer.action === "none" ? "show_menu" : answer.action };
      if (!ordering) answer.reply = "Our team will confirm the exact price for you shortly.";
    }

    const intent = ordering ? actionIntent(answer) : null;
    if (intent) {
      // The assistant's words become the body of the list / buttons it chose.
      await runOrderIntent(conversationId, intent, intent.type === "suggest" || intent.type === "menu" ? undefined : answer.reply);
    } else {
      await sendChatMessage(now, answer.reply, "AI");
    }
    if (now.state !== "AI_HANDLING") {
      await changeHandling(conversationId, { state: "AI_HANDLING", reason: null }, { type: "ai", label: resolved.provider.label });
    }
  } catch (e) {
    await stopTyping(conversationId).catch(() => {});
    // eslint-disable-next-line no-console
    console.error("[wa-chat] AI reply failed:", conversationId, e);
  }
}

/** The AI's chosen action → an ordering step (null = just send its reply). */
function actionIntent(a: AssistantAnswer): OrderIntent | null {
  switch (a.action) {
    case "suggest":
      return a.items.length ? { type: "suggest", ids: a.items.map((i) => i.id), body: a.reply } : null;
    case "show_menu":
      return { type: "menu", body: a.reply };
    case "add_to_cart":
      return a.items.length ? { type: "add_many", items: a.items } : null;
    case "show_cart":
      return { type: "cart" };
    case "checkout":
      return { type: "checkout" };
    case "clear_cart":
      return { type: "clear" };
    case "resend_link":
      return { type: "resend_link" };
    default:
      return null;
  }
}

/** "typing…" for the customer (and staff) while a reply is being prepared. */
async function showTyping(conversationId: string, waMessageId: string | null) {
  await prisma.waConversation.update({ where: { id: conversationId }, data: { aiTypingAt: new Date() } });
  if (waMessageId && whatsappConfigured()) void markRead(waMessageId, true);
}

/**
 * One ordering step, then its replies. Steps for the same conversation run
 * one at a time (a Postgres advisory lock), so two quick taps can't both read
 * the cart before either has saved it.
 */
export async function runOrderIntent(conversationId: string, intent: OrderIntent, lead?: string) {
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${conversationId}))`;
      let outs = await applyIntent(conversationId, intent);
      if (lead) outs = withLead(outs, lead);
      const conv = await prisma.waConversation.findUniqueOrThrow({ where: { id: conversationId } });
      for (const o of outs) await sendChatMessage(conv, o, "AI");
      if (!outs.length) await stopTyping(conversationId);
    },
    { maxWait: 20_000, timeout: 60_000 },
  );
}

/** The assistant won't answer after all: drop the "typing…" bubble. */
async function stopTyping(conversationId: string) {
  await prisma.waConversation.updateMany({ where: { id: conversationId, aiTypingAt: { not: null } }, data: { aiTypingAt: null } });
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
