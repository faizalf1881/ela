import crypto from "node:crypto";
import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { applyDeliveryReceipt } from "@/lib/order-notify";
import { aiReply, applyChatReceipt, recordInbound, sendChatMessage } from "@/lib/wa-chat";
import { applyCampaignReceipt, optIn, optKeyword, optOut } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The AI reply runs after Meta has its 200; give it room to think.
export const maxDuration = 60;

/**
 * WhatsApp Cloud API webhook.
 *
 * Meta → your app → WhatsApp → Configuration → Webhook:
 *   Callback URL:  https://YOUR-DOMAIN/api/webhooks/whatsapp
 *   Verify token:  the value of WHATSAPP_VERIFY_TOKEN
 *   Subscribe to:  messages, and user_preferences (marketing opt-outs)
 * Every POST is signed with the app secret (WHATSAPP_APP_SECRET); unsigned or
 * mis-signed requests are rejected, so events cannot be forged.
 */

// GET — the one-time verification handshake Meta performs when you save the URL.
export async function GET(req: Request) {
  const u = new URL(req.url);
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  const challenge = u.searchParams.get("hub.challenge");
  if (u.searchParams.get("hub.mode") === "subscribe" && expected && u.searchParams.get("hub.verify_token") === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

function validSignature(raw: string, header: string | null, secret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest();
  const given = Buffer.from(header.slice(7), "hex");
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

type Receipt = { id: string; status: string; timestamp?: string; recipient_id?: string; errors?: { code?: number; title?: string; message?: string }[] };
type Contact = { wa_id?: string; profile?: { name?: string } };
type Preference = { wa_id?: string; category?: string; value?: string; detail?: string };
type ChangeValue = { statuses?: Receipt[]; messages?: Parameters<typeof recordInbound>[0][]; contacts?: Contact[]; user_preferences?: Preference[] };
type Payload = { object?: string; entry?: { changes?: { field?: string; value?: ChangeValue }[] }[] };

export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  const raw = await req.text();
  if (!secret) {
    // eslint-disable-next-line no-console
    console.error("[WhatsApp webhook] WHATSAPP_APP_SECRET is not set — refusing unverifiable events.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let receipts = 0;
  let messages = 0;
  let preferences = 0;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (!change.value) continue;
      const v = change.value;

      // WhatsApp's own "stop marketing" / "resume" choice (spec #16: respect every opt-out).
      if (change.field === "user_preferences") {
        for (const p of v.user_preferences ?? []) {
          if (p.category !== "marketing_messages" || !p.wa_id) continue;
          if (p.value === "stop") await optOut(p.wa_id, "whatsapp");
          else if (p.value === "resume") await optIn(p.wa_id);
          else continue;
          preferences++;
        }
        continue;
      }
      if (change.field !== "messages") continue;

      // Receipts belong to an order update, a chat reply or a campaign message.
      for (const r of v.statuses ?? []) {
        if (!r?.id || !r?.status) continue;
        if ((await applyDeliveryReceipt(r)) || (await applyChatReceipt(r)) || (await applyCampaignReceipt(r))) receipts++;
      }

      // Customer messages → the CRM chat; the AI answers after this response.
      for (const m of v.messages ?? []) {
        const profile = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? null;
        const saved = await recordInbound(m, profile);
        if (!saved) continue; // redelivered — already handled
        messages++;
        const text = m.type === "text" ? (m.text?.body ?? "") : m.type === "button" ? (m.button?.text ?? "") : (m.interactive?.button_reply?.title ?? "");
        after(async () => {
          // STOP / START is honoured in any mode, and never sent to the AI.
          const confirmation = text ? await optKeyword(m.from, text) : null;
          if (confirmation) {
            const conv = await prisma.waConversation.findUnique({ where: { id: saved.conversationId } });
            if (conv) await sendChatMessage(conv, confirmation, "AI");
            return;
          }
          if (saved.mode === "AI") await aiReply(saved.conversationId, saved.messageId);
        });
      }
    }
  }

  // Always 200 for a verified event: Meta retries anything else for days.
  return NextResponse.json({ ok: true, receipts, messages, preferences });
}
