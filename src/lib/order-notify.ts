import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { inr, normalizePhone } from "./utils";
import { sendWhatsApp, whatsappConfigured, type GraphResult } from "./whatsapp";
import type { OrderStatus } from "./order-status";

/**
 * Automatic WhatsApp order-status messages (spec #45/#46).
 *
 * Each real status transition produces one OrderNotification row, created
 * before anything is sent, then updated with the outcome: SENT (with WhatsApp's
 * message id, so delivery/read receipts can be attached later), FAILED (with
 * the API response and a plain-English reason for staff), or SKIPPED. Nothing
 * here throws and nothing touches the order: a failed message never rolls back
 * the status that caused it.
 */

export const NOTIFY_STATUSES = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;
export type NotifyStatus = (typeof NOTIFY_STATUSES)[number];
export const isNotifyStatus = (s: string): s is NotifyStatus => (NOTIFY_STATUSES as readonly string[]).includes(s);

/** Built-in wording. {name} {order} {invoice} {total} {when} {items} are filled in per order. */
export const DEFAULT_MESSAGES: Record<NotifyStatus, string> = {
  PLACED:
    "✅ *Order confirmed!*\nHi {name}, we've received your order *{order}* ({total}).\nDelivery: {when}\nOur kitchen will start preparing it shortly.\n— Ela & Co.",
  PREPARING: "👩‍🍳 Hi {name}, your order *{order}* is being freshly prepared. — Ela & Co.",
  OUT_FOR_DELIVERY: "🛵 Hi {name}, your order *{order}* is out for delivery and will reach you soon! — Ela & Co.",
  DELIVERED: "🎉 Your order *{order}* has been delivered. Enjoy your meal, {name}! We'd love your feedback. — Ela & Co.",
  CANCELLED: "Your order *{order}* has been cancelled. If this was unexpected, reply here and we'll help. — Ela & Co.",
};

export const PLACEHOLDERS = ["name", "order", "invoice", "total", "when", "items"] as const;

type OrderForMessage = Prisma.OrderGetPayload<{ include: { items: true; deliverySlot: true } }>;

function varsFor(o: OrderForMessage): Record<string, string> {
  const day = o.deliveryDate
    ? new Date(o.deliveryDate).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
    : "";
  return {
    name: (o.customerName || "there").trim().split(/\s+/)[0],
    order: `#${o.id.slice(-6).toUpperCase()}`,
    invoice: o.invoiceNo || "",
    total: inr(o.total),
    when: [day, o.deliverySlot?.label].filter(Boolean).join(", "),
    items: o.items.map((i) => `${i.qty}× ${i.name}`).join(", "),
  };
}

/**
 * Fills the placeholders. A line whose placeholder came out empty and leaves
 * only a dangling label ("Delivery:") is dropped rather than sent half-empty.
 */
export function renderMessage(template: string, vars: Record<string, string>): string {
  return template
    .split("\n")
    .flatMap((line) => {
      let emptied = false;
      const out = line.replace(/\{(\w+)\}/g, (m, k: string) => {
        if (!(k in vars)) return m;
        if (!vars[k]) emptied = true;
        return vars[k];
      });
      return emptied && /:\s*$/.test(out.trim()) ? [] : [out];
    })
    .join("\n")
    .trim();
}

/** Template variables may not contain newlines, tabs or long runs of spaces. */
function oneLine(text: string): string {
  return text.replace(/\*/g, "").replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 1000);
}

type Setting = Awaited<ReturnType<typeof loadSetting>>;
async function loadSetting() {
  return prisma.storeSetting.findUnique({
    where: { id: 1 },
    select: { notifyStatuses: true, notifyMessages: true, waStatusTemplate: true, waStatusTemplateLang: true },
  });
}

export function messageTemplateFor(status: NotifyStatus, setting: Setting): string {
  const custom = (setting?.notifyMessages as Record<string, unknown> | null)?.[status];
  return typeof custom === "string" && custom.trim() ? custom : DEFAULT_MESSAGES[status];
}

/** Turns a Graph API failure into something staff can act on. */
export function explainWhatsAppError(r: GraphResult): string {
  const err = (r.data as { error?: { code?: number; message?: string; error_data?: { details?: string } } })?.error;
  const code = err?.code;
  const detail = err?.error_data?.details || err?.message || r.error || "Unknown error";
  switch (code) {
    case 190:
      return "WhatsApp access token is invalid or expired. Generate a new permanent token in Meta Business Suite and update WHATSAPP_TOKEN.";
    case 131047:
      return "The customer hasn't messaged in the last 24 hours, so WhatsApp only allows an approved template. Add a status template in Settings.";
    case 131030:
      return "This number isn't on the allowed recipient list (WhatsApp test mode).";
    case 131026:
      return "WhatsApp couldn't deliver to this number (it may not use WhatsApp).";
    case 132000:
    case 132001:
      return `The WhatsApp template wasn't accepted (name, language or approval). ${detail}`;
    default:
      return r.status === 0 ? `Could not reach WhatsApp: ${detail}` : `WhatsApp error${code ? ` ${code}` : ""}: ${detail}`;
  }
}

/** Create the log row and send. Never throws. */
export async function notifyOrderStatus(orderId: string, from: OrderStatus | null): Promise<void> {
  try {
    const [order, setting] = await Promise.all([
      prisma.order.findUnique({ where: { id: orderId }, include: { items: true, deliverySlot: true } }),
      loadSetting(),
    ]);
    if (!order || !isNotifyStatus(order.status)) return;
    const to = order.status;
    const enabled = setting?.notifyStatuses ?? [...NOTIFY_STATUSES];
    if (!enabled.includes(to)) return;

    const phone = normalizePhone(order.customerPhone);
    const row = await prisma.orderNotification.create({
      data: {
        orderId: order.id,
        customerName: order.customerName,
        phone: phone || order.customerPhone,
        fromStatus: from,
        toStatus: to,
        body: renderMessage(messageTemplateFor(to, setting), varsFor(order)),
      },
    });
    if (!phone) {
      await prisma.orderNotification.update({
        where: { id: row.id },
        data: { status: "SKIPPED", error: "The order has no valid WhatsApp number." },
      });
      return;
    }
    await deliverNotification(row.id);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[notify] order status notification failed:", orderId, e);
  }
}

/**
 * Sends (or re-sends) a logged notification: the approved template first when
 * one is configured (it works outside the 24-hour window), otherwise or on its
 * failure plain text. Every attempt's raw response is kept.
 */
export async function deliverNotification(id: string) {
  const n = await prisma.orderNotification.findUnique({ where: { id }, include: { order: true } });
  if (!n) return null;

  if (!whatsappConfigured()) {
    // eslint-disable-next-line no-console
    console.log(`\n💬  [Ela WA]  ${n.phone}  →  ${n.body}\n`);
    return prisma.orderNotification.update({
      where: { id },
      data: { status: "SKIPPED", attempts: { increment: 1 }, error: "WhatsApp is not configured on this server (WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TOKEN)." },
    });
  }

  const setting = await loadSetting();
  const attempts: { via: string; status: number; data: unknown; error?: string }[] = [];
  let sent: { type: "template" | "text"; result: GraphResult } | null = null;
  let lastFailure: GraphResult | null = null;

  const template = setting?.waStatusTemplate?.trim();
  if (template) {
    const lang = setting?.waStatusTemplateLang || "en";
    const params = [(n.customerName || "there").trim().split(/\s+/)[0], `#${n.orderId.slice(-6).toUpperCase()}`, oneLine(n.body)];
    const r = await sendWhatsApp(n.phone, { type: "template", name: template, lang, params });
    attempts.push({ via: `template ${template}/${lang}`, status: r.status, data: r.data, error: r.error });
    if (r.ok) sent = { type: "template", result: r };
    else lastFailure = r;
  }
  if (!sent) {
    const r = await sendWhatsApp(n.phone, { type: "text", body: n.body });
    attempts.push({ via: "text", status: r.status, data: r.data, error: r.error });
    if (r.ok) sent = { type: "text", result: r };
    // The template's reason is usually the useful one when both fail.
    else lastFailure = template && lastFailure ? lastFailure : r;
  }

  return prisma.orderNotification.update({
    where: { id },
    data: sent
      ? {
          status: "SENT",
          messageType: sent.type,
          templateName: sent.type === "template" ? template : null,
          waMessageId: sent.result.messageId ?? null,
          sentAt: new Date(),
          error: null,
          deliveryStatus: null,
          attempts: { increment: 1 },
          response: attempts as unknown as Prisma.InputJsonValue,
        }
      : {
          status: "FAILED",
          error: lastFailure ? explainWhatsAppError(lastFailure) : "Send failed",
          attempts: { increment: 1 },
          response: attempts as unknown as Prisma.InputJsonValue,
        },
  });
}

const RECEIPT_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3 };

/**
 * Applies a WhatsApp delivery receipt (webhook `statuses`). Receipts can arrive
 * out of order, so a later stage is never overwritten by an earlier one; a
 * "failed" receipt marks the notification FAILED for follow-up.
 */
export async function applyDeliveryReceipt(receipt: {
  id: string;
  status: string;
  timestamp?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}): Promise<boolean> {
  const n = await prisma.orderNotification.findUnique({ where: { waMessageId: receipt.id } });
  if (!n) return false;
  const at = receipt.timestamp ? new Date(Number(receipt.timestamp) * 1000) : new Date();

  if (receipt.status === "failed") {
    const e = receipt.errors?.[0];
    await prisma.orderNotification.update({
      where: { id: n.id },
      data: {
        status: "FAILED",
        deliveryStatus: "failed",
        error: `WhatsApp could not deliver the message${e ? `: ${e.error_data?.details || e.message || e.title} (${e.code})` : "."}`,
      },
    });
    return true;
  }
  const rank = RECEIPT_RANK[receipt.status];
  if (!rank || (n.deliveryStatus && (RECEIPT_RANK[n.deliveryStatus] ?? 0) >= rank)) return true;
  await prisma.orderNotification.update({
    where: { id: n.id },
    data: {
      deliveryStatus: receipt.status,
      ...(receipt.status === "delivered" ? { deliveredAt: at } : {}),
      ...(receipt.status === "read" ? { readAt: at, deliveredAt: n.deliveredAt ?? at } : {}),
    },
  });
  return true;
}
