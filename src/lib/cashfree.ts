import "server-only";
import crypto from "node:crypto";

/**
 * Cashfree Payment Gateway (REST, API version 2026-01-01). The App ID and
 * Secret Key live only in server env vars — never in the browser. Amounts are
 * whole rupees here and sent as rupees (Cashfree does not use paise).
 *
 * Env: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, and optionally CASHFREE_ENV
 * (sandbox | production; worked out from the key when unset) and
 * CASHFREE_API_BASE (tests point it at a local stand-in).
 */
const API_VERSION = "2026-01-01";

export type CashfreeMode = "sandbox" | "production";

function config() {
  const appId = process.env.CASHFREE_APP_ID?.trim();
  const secret = process.env.CASHFREE_SECRET_KEY?.trim();
  const explicit = process.env.CASHFREE_ENV?.trim().toLowerCase();
  // Test credentials are marked: App IDs start with TEST, secret keys contain _test_.
  const mode: CashfreeMode =
    explicit === "sandbox" || explicit === "test"
      ? "sandbox"
      : explicit === "production" || explicit === "prod" || explicit === "live"
        ? "production"
        : /^TEST/i.test(appId ?? "") || /_test_/i.test(secret ?? "")
          ? "sandbox"
          : "production";
  const base = (process.env.CASHFREE_API_BASE || (mode === "sandbox" ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg")).replace(/\/$/, "");
  return { appId, secret, mode, base, configured: Boolean(appId && secret) };
}

export function cashfreeConfigured(): boolean {
  return config().configured;
}
export function cashfreeMode(): CashfreeMode {
  return config().mode;
}

export class CashfreeError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code?: string,
  ) {
    super(message);
    this.name = "CashfreeError";
  }
}

async function call<T>(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const { appId, secret, base, configured } = config();
  if (!configured) throw new CashfreeError("Cashfree is not set up on this server (CASHFREE_APP_ID / CASHFREE_SECRET_KEY).");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "x-client-id": appId!,
        "x-client-secret": secret!,
        "x-api-version": API_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new CashfreeError(`Could not reach Cashfree: ${(e as Error).message}`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (!res.ok) {
    const err = data as { message?: string; code?: string; type?: string } | null;
    // eslint-disable-next-line no-console
    console.error("[Cashfree]", method, path, res.status, text.slice(0, 500));
    throw new CashfreeError(err?.message || `Cashfree error ${res.status}`, res.status, err?.code || err?.type);
  }
  return data as T;
}

export type CashfreeOrder = {
  cf_order_id?: string | number;
  order_id: string;
  order_amount: number;
  order_currency: string;
  order_status: "ACTIVE" | "PAID" | "EXPIRED" | "TERMINATED" | "TERMINATION_REQUESTED";
  payment_session_id?: string;
  order_tags?: Record<string, string> | null;
};

export type CashfreePayment = {
  cf_payment_id: string | number;
  payment_status: "SUCCESS" | "NOT_ATTEMPTED" | "FAILED" | "USER_DROPPED" | "VOID" | "CANCELLED" | "PENDING";
  payment_amount: number;
  payment_message?: string;
};

/** Cashfree wants a 10-digit Indian mobile, or a full number with "+". */
export function cashfreePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 10) return digits;
  return digits.length > 10 ? `+${digits}` : digits;
}

export async function createCashfreeOrder(o: {
  orderId: string;
  amount: number;
  customer: { id: string; phone: string; name?: string | null };
  returnUrl: string;
  notifyUrl?: string | null;
  note?: string;
  tags?: Record<string, string>;
}): Promise<CashfreeOrder> {
  return call<CashfreeOrder>(
    "POST",
    "/orders",
    {
      order_id: o.orderId,
      order_amount: o.amount,
      order_currency: "INR",
      customer_details: {
        customer_id: o.customer.id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50),
        customer_phone: cashfreePhone(o.customer.phone),
        ...(o.customer.name && o.customer.name.trim().length >= 3 ? { customer_name: o.customer.name.trim().slice(0, 100) } : {}),
      },
      order_meta: {
        return_url: o.returnUrl,
        // Cashfree only calls https endpoints; local development relies on the return check.
        ...(o.notifyUrl && o.notifyUrl.startsWith("https://") ? { notify_url: o.notifyUrl } : {}),
      },
      ...(o.note ? { order_note: o.note.slice(0, 200) } : {}),
      ...(o.tags ? { order_tags: o.tags } : {}),
    },
    o.orderId,
  );
}

export async function getCashfreeOrder(orderId: string): Promise<CashfreeOrder> {
  return call<CashfreeOrder>("GET", `/orders/${encodeURIComponent(orderId)}`);
}

export async function getCashfreePayments(orderId: string): Promise<CashfreePayment[]> {
  const list = await call<CashfreePayment[] | null>("GET", `/orders/${encodeURIComponent(orderId)}/payments`);
  return Array.isArray(list) ? list : [];
}

export type CashfreeRefund = { cf_refund_id?: string | number; refund_id: string; refund_status: string; refund_amount?: number; status_description?: string };

export async function createCashfreeRefund(orderId: string, r: { refundId: string; amount: number; note: string }): Promise<CashfreeRefund> {
  const note = r.note.trim().padEnd(3, ".").slice(0, 100);
  return call<CashfreeRefund>("POST", `/orders/${encodeURIComponent(orderId)}/refunds`, { refund_id: r.refundId, refund_amount: r.amount, refund_note: note, refund_speed: "STANDARD" }, r.refundId);
}

/**
 * Webhook signature: base64(HMAC-SHA256(timestamp + rawBody)) with the Secret
 * Key, in x-webhook-signature / x-webhook-timestamp. Must be checked against
 * the raw body — re-serialising JSON changes amounts like 170.00.
 */
export function verifyCashfreeWebhook(rawBody: string, signature: string | null, timestamp: string | null): boolean {
  const { secret } = config();
  if (!secret || !signature || !timestamp) return false;
  const expected = crypto.createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
