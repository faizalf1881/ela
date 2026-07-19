import "server-only";
import { sendWhatsAppText } from "./whatsapp";
import { normalizePhone, inr } from "./utils";

export type NotifyOrder = {
  id: string;
  invoiceNo?: string | null;
  customerName: string;
  customerPhone: string;
  total: number;
  status: string;
};

const shortId = (id: string) => id.slice(-6).toUpperCase();
const firstName = (name: string) => (name || "there").trim().split(/\s+/)[0];

/** Customer-facing message per status (Zomato/Swiggy style). */
const STATUS_MSG: Record<string, (o: NotifyOrder) => string> = {
  PLACED: (o) =>
    `✅ *Order confirmed!*\nHi ${firstName(o.customerName)}, we've received your order *#${shortId(o.id)}* (${inr(o.total)}). Our kitchen will start preparing it shortly.\n— Ela & Co.`,
  PREPARING: (o) => `👩‍🍳 Your order *#${shortId(o.id)}* is being freshly prepared. — Ela & Co.`,
  OUT_FOR_DELIVERY: (o) => `🛵 Your order *#${shortId(o.id)}* is on the way and will reach you soon! — Ela & Co.`,
  DELIVERED: (o) => `🎉 Order *#${shortId(o.id)}* delivered. Enjoy your meal, ${firstName(o.customerName)}! We'd love your feedback. — Ela & Co.`,
  CANCELLED: (o) => `Your order *#${shortId(o.id)}* has been cancelled. If this was unexpected, reply here and we'll help. — Ela & Co.`,
};

/** Notify the customer that their order reached `o.status`. Never throws. */
export async function notifyOrderStatus(o: NotifyOrder): Promise<void> {
  const build = STATUS_MSG[o.status];
  if (!build) return;
  const phone = normalizePhone(o.customerPhone);
  if (!phone) return;
  try {
    await sendWhatsAppText(phone, build(o));
  } catch {
    /* notifications are best-effort */
  }
}

/** Notify the restaurant owner of a new order (if ADMIN_NOTIFY_PHONE is set). */
export async function notifyNewOrderToAdmin(o: NotifyOrder): Promise<void> {
  const admin = normalizePhone(process.env.ADMIN_NOTIFY_PHONE || "");
  if (!admin) return;
  const body = `🔔 *New order #${shortId(o.id)}* — ${inr(o.total)}\nFrom ${o.customerName} (${o.customerPhone}).\nOpen the admin panel to manage it.`;
  try {
    await sendWhatsAppText(admin, body);
  } catch {
    /* best-effort */
  }
}
