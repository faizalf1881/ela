import "server-only";
import fs from "node:fs";

// Graph API v21.0 stops working on 21 Jan 2027, so the default is a current
// version. WHATSAPP_API_VERSION picks another; WHATSAPP_API_BASE (tests) points
// everything at a local stand-in.
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v24.0";
const GRAPH_BASE = (process.env.WHATSAPP_API_BASE || `https://graph.facebook.com/${API_VERSION}`).replace(/\/$/, "");

type SendResult = { ok: boolean; via: "whatsapp" | "console"; error?: string; messageId?: string };

/** Raw outcome of one Graph API call, kept for the notification log. */
export type GraphResult = { ok: boolean; status: number; data: unknown; error?: string; messageId?: string };

function config() {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return {
    token,
    phoneNumberId,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    devMode: process.env.OTP_DEV_MODE === "true",
    configured: Boolean(token && phoneNumberId),
  };
}

/** True when a phone number id and token are set (real sends are possible). */
export function whatsappConfigured(): boolean {
  return config().configured;
}

async function request(method: "GET" | "POST", url: string, payload?: Record<string, unknown>): Promise<GraphResult> {
  const { token } = config();
  try {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {}
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error(`[WhatsApp] ${method} failed:`, res.status, text);
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

async function post(payload: Record<string, unknown>): Promise<GraphResult> {
  return request("POST", `${GRAPH_BASE}/${config().phoneNumberId}/messages`, payload);
}

// ---------------------------------------------------------------------------
// Interactive messages (spec #14). WhatsApp rejects anything over its limits,
// so every text is clipped here, at the one place messages leave the app.
// ---------------------------------------------------------------------------

export type ChatButton = { id: string; title: string };
export type ChatListRow = { id: string; title: string; description?: string };
export type Interactive =
  | { kind: "buttons"; body: string; buttons: ChatButton[]; header?: string; footer?: string; imageUrl?: string }
  | { kind: "list"; body: string; button: string; sections: { title?: string; rows: ChatListRow[] }[]; header?: string; footer?: string }
  | { kind: "cta_url"; body: string; displayText: string; url: string; header?: string; footer?: string };

export const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

function interactivePayload(m: Interactive) {
  const footer = m.footer ? { footer: { text: clip(m.footer, 60) } } : {};
  if (m.kind === "buttons") {
    const header = m.imageUrl ? { header: { type: "image", image: { link: m.imageUrl } } } : m.header ? { header: { type: "text", text: clip(m.header, 60) } } : {};
    return {
      type: "button",
      ...header,
      body: { text: clip(m.body, 1024) },
      ...footer,
      action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: clip(b.title, 20) } })) },
    };
  }
  if (m.kind === "list") {
    // At most 10 rows across all sections; titles are required once there are several sections.
    let left = 10;
    const sections = m.sections
      .map((sec) => {
        const rows = sec.rows.slice(0, Math.max(0, left));
        left -= rows.length;
        return { sec, rows };
      })
      .filter((x) => x.rows.length)
      .slice(0, 10)
      .map(({ sec, rows }, _i, all) => ({
        ...(sec.title || all.length > 1 ? { title: clip(sec.title || "Options", 24) } : {}),
        rows: rows.map((r) => ({ id: r.id.slice(0, 200), title: clip(r.title, 24), ...(r.description ? { description: clip(r.description, 72) } : {}) })),
      }));
    return {
      type: "list",
      ...(m.header ? { header: { type: "text", text: clip(m.header, 60) } } : {}),
      body: { text: clip(m.body, 4096) },
      ...footer,
      action: { button: clip(m.button, 20), sections },
    };
  }
  return {
    type: "cta_url",
    ...(m.header ? { header: { type: "text", text: clip(m.header, 60) } } : {}),
    body: { text: clip(m.body, 1024) },
    ...footer,
    action: { name: "cta_url", parameters: { display_text: clip(m.displayText, 20), url: m.url } },
  };
}

/** How an interactive message reads as plain text (thread previews, the AI's history). */
export function interactiveText(m: Interactive): string {
  if (m.kind === "buttons") return `${m.body}\n${m.buttons.map((b) => `[${b.title}]`).join(" ")}`;
  if (m.kind === "list") return `${m.body}\n[${m.button}: ${m.sections.flatMap((s) => s.rows.map((r) => r.title)).join(" · ")}]`;
  return `${m.body}\n[${m.displayText}: ${m.url}]`;
}

export type OutgoingMessage =
  | { type: "text"; body: string }
  | { type: "template"; name: string; lang: string; params: string[] }
  /** A template with its full set of components (header media, named variables, buttons). */
  | { type: "template_components"; name: string; lang: string; components: unknown[] }
  | { type: "interactive"; message: Interactive };

/**
 * Sends one message and returns the raw Graph API outcome (message id on
 * success, error text otherwise). Used where every attempt must be recorded:
 * order-status notifications, the CRM chat and campaigns.
 */
export async function sendWhatsApp(phone: string, msg: OutgoingMessage): Promise<GraphResult> {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to: phone };
  if (msg.type === "text") return post({ ...base, type: "text", text: { body: msg.body, preview_url: false } });
  if (msg.type === "interactive") return post({ ...base, type: "interactive", interactive: interactivePayload(msg.message) });
  if (msg.type === "template_components") {
    return post({ ...base, type: "template", template: { name: msg.name, language: { code: msg.lang }, components: msg.components } });
  }
  return post({
    ...base,
    type: "template",
    template: {
      name: msg.name,
      language: { code: msg.lang },
      components: msg.params.length ? [{ type: "body", parameters: msg.params.map((t) => ({ type: "text", text: t })) }] : [],
    },
  });
}

/**
 * Marks a customer's message read (blue ticks) and, with `typing`, shows them
 * "typing…" until we reply or for up to 25 seconds. Needs the id of a message
 * they sent. Only used when a reply really is on its way.
 */
export async function markRead(messageId: string, typing = false): Promise<GraphResult> {
  return post({ messaging_product: "whatsapp", status: "read", message_id: messageId, ...(typing ? { typing_indicator: { type: "text" } } : {}) });
}

export type MetaTemplate = {
  id?: string;
  name: string;
  language: string;
  status: string;
  category: string;
  parameter_format?: string;
  components?: unknown[];
};

/**
 * Every message template on the WhatsApp Business Account (all statuses), for
 * Admin → templates. Needs WHATSAPP_BUSINESS_ACCOUNT_ID and a token with the
 * whatsapp_business_management permission.
 */
export async function fetchTemplates(): Promise<{ ok: true; templates: MetaTemplate[] } | { ok: false; error: string; status: number; data?: unknown }> {
  const { businessAccountId, configured } = config();
  if (!configured) return { ok: false, status: 0, error: "WhatsApp is not configured on this server (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)." };
  if (!businessAccountId) {
    return { ok: false, status: 0, error: "Add WHATSAPP_BUSINESS_ACCOUNT_ID (Meta → WhatsApp Manager → Account tools → WhatsApp Business Account ID) to sync templates." };
  }
  const templates: MetaTemplate[] = [];
  let url: string | undefined = `${GRAPH_BASE}/${businessAccountId}/message_templates?fields=name,status,language,category,components,parameter_format&limit=100`;
  for (let page = 0; url && page < 20; page++) {
    const r = await request("GET", url);
    if (!r.ok) return { ok: false, status: r.status, error: r.error || "Could not load templates", data: r.data };
    const d = r.data as { data?: MetaTemplate[]; paging?: { next?: string } };
    templates.push(...(d.data ?? []));
    const next: string | undefined = d.paging?.next;
    // Only follow paging links back to the Graph API itself (the token goes with them).
    url = next && (next.startsWith(GRAPH_BASE) || next.startsWith("https://graph.facebook.com/")) ? next : undefined;
  }
  return { ok: true, templates };
}

/**
 * The sending number's health: quality rating and the business portfolio's
 * daily limit for starting conversations (TIER_250, TIER_2K, …).
 */
export async function fetchNumberHealth(): Promise<{ ok: boolean; quality?: string; limit?: string; name?: string; number?: string; error?: string }> {
  const { phoneNumberId, configured } = config();
  if (!configured) return { ok: false, error: "WhatsApp is not configured on this server." };
  for (const fields of ["display_phone_number,verified_name,quality_rating,whatsapp_business_manager_messaging_limit", "display_phone_number,verified_name,quality_rating"]) {
    const r = await request("GET", `${GRAPH_BASE}/${phoneNumberId}?fields=${fields}`);
    if (!r.ok) continue;
    const d = r.data as { display_phone_number?: string; verified_name?: string; quality_rating?: string; whatsapp_business_manager_messaging_limit?: string };
    return { ok: true, quality: d.quality_rating, limit: d.whatsapp_business_manager_messaging_limit, name: d.verified_name, number: d.display_phone_number };
  }
  return { ok: false, error: "Could not read the number's status from WhatsApp." };
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
