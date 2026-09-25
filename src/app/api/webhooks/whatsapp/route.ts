import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { applyDeliveryReceipt } from "@/lib/order-notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WhatsApp Cloud API webhook.
 *
 * Meta → your app → WhatsApp → Configuration → Webhook:
 *   Callback URL:  https://YOUR-DOMAIN/api/webhooks/whatsapp
 *   Verify token:  the value of WHATSAPP_VERIFY_TOKEN
 *   Subscribe to:  messages
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
type ChangeValue = { statuses?: Receipt[]; messages?: unknown[]; contacts?: unknown[] };
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
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      for (const r of change.value.statuses ?? []) {
        if (r?.id && r?.status && (await applyDeliveryReceipt(r))) receipts++;
      }
    }
  }

  // Always 200 for a verified event: Meta retries anything else for days.
  return NextResponse.json({ ok: true, receipts });
}
