import "server-only";
import fs from "node:fs";

const GRAPH_VERSION = "v21.0";

type SendResult = { ok: boolean; via: "whatsapp" | "console"; error?: string };

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

async function post(payload: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const { token, phoneNumberId } = config();
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      // eslint-disable-next-line no-console
      console.error("[WhatsApp] send failed:", res.status, text);
      return { ok: false, error: `${res.status}: ${text}` };
    }
    return { ok: true };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[WhatsApp] network error:", e);
    return { ok: false, error: String(e) };
  }
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
    if (r.ok) return { ok: true, via: "whatsapp" };
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
  return { ok: true, via: "whatsapp" };
}
