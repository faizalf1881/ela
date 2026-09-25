import "server-only";
import fs from "node:fs";

// Overridable so tests can point at a local stand-in for the Graph API.
const GRAPH_BASE = (process.env.WHATSAPP_API_BASE || "https://graph.facebook.com/v21.0").replace(/\/$/, "");

type SendResult = { ok: boolean; via: "whatsapp" | "console"; error?: string; messageId?: string };

/** Raw outcome of one Graph API call, kept for the notification log. */
export type GraphResult = { ok: boolean; status: number; data: unknown; error?: string; messageId?: string };

function config() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return {
    token,
    phoneNumberId,
    devMode: process.env.OTP_DEV_MODE === "true",
    configured: Boolean(token && phoneNumberId),
  };
}

/** True when a phone number id and token are set (real sends are possible). */
export function whatsappConfigured(): boolean {
  return config().configured;
}

async function post(payload: Record<string, unknown>): Promise<GraphResult> {
  const { token, phoneNumberId } = config();
  const url = `${GRAPH_BASE}/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error("[WhatsApp] send failed:", res.status, text);
      return { ok: false, status: res.status, data, error: `${res.status}: ${text}` };
    }
    const messageId = (data as { messages?: { id?: string }[] })?.messages?.[0]?.id;
    return { ok: true, status: res.status, data, messageId };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[WhatsApp] network error:", e);
    return { ok: false, status: 0, data: null, error: String(e) };
  }
}

export type OutgoingMessage =
  | { type: "text"; body: string }
  | { type: "template"; name: string; lang: string; params: string[] };

/**
 * Sends one message and returns the raw Graph API outcome (message id on
 * success, error text otherwise). Used where every attempt must be recorded:
 * order-status notifications and the CRM chat.
 */
export async function sendWhatsApp(phone: string, msg: OutgoingMessage): Promise<GraphResult> {
  const payload =
    msg.type === "text"
      ? { messaging_product: "whatsapp", to: phone, type: "text", text: { body: msg.body, preview_url: false } }
      : {
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: msg.name,
            language: { code: msg.lang },
            components: msg.params.length ? [{ type: "body", parameters: msg.params.map((t) => ({ type: "text", text: t })) }] : [],
          },
        };
  return post(payload);
}

/**
 * Sends an OTP via the approved authentication template (WHATSAPP_TEMPLATE_NAME),
 * falling back to plain text, then to the dev console. `phone` must be digits
 * with country code (e.g. 917907577979).
 */
export async function sendOtp(phone: string, code: string): Promise<SendResult> {
  const { devMode, configured } = config();
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const lang = process.env.WHATSAPP_TEMPLATE_LANG || "en";

  if (devMode || !configured) {
    // eslint-disable-next-line no-console
    console.log(`\n🔐  [Ela OTP]  ${phone}  →  ${code}   (expires in 5 min)\n`);
    if (devMode && process.env.OTP_LOG_FILE) {
      try {
        fs.appendFileSync(process.env.OTP_LOG_FILE, `${phone} ${code}\n`);
      } catch {}
    }
  }

  if (!configured) return { ok: true, via: "console" };

  const bodyOnly = [{ type: "body", parameters: [{ type: "text", text: code }] }];
  const withButton = [
    ...bodyOnly,
    // Only valid when the approved template has a "copy code" / URL button.
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
  ];

  const tpl = (name: string, code2: string, components: unknown[]) => ({
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: { name, language: { code: code2 }, components },
  });

  const plainText = {
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body: `Your Ela & Co. verification code is ${code}. It expires in 5 minutes.` },
  };

  // Authentication templates differ by whether they carry a copy-code button, and
  // are approved under either "en" or "en_US". Rather than guessing, try each
  // shape until WhatsApp accepts one, then fall back to a plain text message.
  const langs = Array.from(new Set([lang, lang.startsWith("en") ? (lang === "en" ? "en_US" : "en") : "en"]));
  const attempts: { label: string; payload: Record<string, unknown> }[] = [];

  if (template) {
    for (const l of langs) {
      attempts.push({ label: `template ${template}/${l} +button`, payload: tpl(template, l, withButton) });
      attempts.push({ label: `template ${template}/${l} body-only`, payload: tpl(template, l, bodyOnly) });
    }
  }
  attempts.push({ label: "plain text", payload: plainText });

  let lastError: string | undefined;
  for (const a of attempts) {
    const r = await post(a.payload);
    if (r.ok) return { ok: true, via: "whatsapp", messageId: r.messageId };
    lastError = `${a.label} → ${r.error}`;
    // eslint-disable-next-line no-console
    console.error(`[WhatsApp] attempt failed (${a.label}):`, r.error);
  }

  return { ok: devMode, via: "whatsapp", error: lastError };
}

/**
 * Sends a free-form WhatsApp text message (used for order-status notifications).
 * Note: outside a 24h customer-service window WhatsApp only delivers approved
 * templates — see notify.ts / README for the utility-template path. Falls back to
 * the dev console. `phone` must be digits with country code.
 */
export async function sendWhatsAppText(phone: string, body: string): Promise<SendResult> {
  const { devMode, configured } = config();

  if (devMode || !configured) {
    // eslint-disable-next-line no-console
    console.log(`\n💬  [Ela WA]  ${phone}  →  ${body}\n`);
  }

  if (!configured) return { ok: true, via: "console" };

  const r = await post({
    messaging_product: "whatsapp",
    to: phone,
    type: "text",
    text: { body },
  });
  if (!r.ok) return { ok: devMode, via: "whatsapp", error: r.error };
  return { ok: true, via: "whatsapp", messageId: r.messageId };
}
