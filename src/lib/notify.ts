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

/** Order-status messages are logged and retryable — see order-notify.ts. */
export { notifyOrderStatus } from "./order-notify";

/** Support-ticket notification to a customer (registered / replied / resolved). Never throws. */
export async function notifyTicket(customerPhone: string, body: string): Promise<void> {
  const phone = normalizePhone(customerPhone);
  if (!phone) return;
  try {
    await sendWhatsAppText(phone, body);
  } catch {
    /* best-effort */
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
