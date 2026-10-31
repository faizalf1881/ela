import "server-only";
import crypto from "node:crypto";
import { after } from "next/server";
import { prisma } from "./db";
import { audit, type AuditActor } from "./audit";
import { razorpay } from "./razorpay";
import { cashfreeConfigured, cashfreeMode, createCashfreeOrder, createCashfreeRefund, getCashfreeOrder, getCashfreePayments, type CashfreeMode } from "./cashfree";
import { finalizeOrder } from "./fulfillment";
import { dateKeyFromDb, istDateKey, istMinutesNow } from "./delivery";
import { notifyNewOrderToAdmin, notifyOrderStatus } from "./notify";

/**
 * Online payments (spec #11 + the move to Cashfree). The admin chooses the
 * gateway in Settings → Payments: AUTO uses Cashfree once its keys are set and
 * Razorpay otherwise. Memberships (Razorpay AutoPay mandates) are unaffected.
 *
 * An order only ever becomes paid through settleOrderPayment(), and only after
 * the gateway itself confirmed the money: a verified Razorpay signature, a
 * Cashfree order read back from Cashfree's API, or a signed webhook. Clicking
 * a payment link, or a browser saying "success", is never enough.
 */

export type Gateway = "cashfree" | "razorpay";
export type GatewayPref = "AUTO" | "CASHFREE" | "RAZORPAY";
export const GATEWAY_LABEL: Record<Gateway, string> = { cashfree: "Cashfree", razorpay: "Razorpay" };

export function gatewayAvailability() {
  return {
    cashfree: { configured: cashfreeConfigured(), mode: cashfreeMode() },
    razorpay: { configured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) },
  };
}

/** The gateway a preference resolves to right now (null = online payment unavailable). */
export function pickGateway(pref: string | null | undefined): Gateway | null {
  const a = gatewayAvailability();
  if (pref === "CASHFREE") return a.cashfree.configured ? "cashfree" : null;
  if (pref === "RAZORPAY") return a.razorpay.configured ? "razorpay" : null;
  return a.cashfree.configured ? "cashfree" : a.razorpay.configured ? "razorpay" : null;
}

export async function activeGateway(): Promise<Gateway | null> {
  const s = await prisma.storeSetting.findUnique({ where: { id: 1 }, select: { paymentGateway: true } });
  return pickGateway(s?.paymentGateway);
}

/** The public address payment links and gateway redirects point to. */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

/**
 * The secret part of an order's payment link (/pay/<id>?k=…). Knowing the
 * link lets someone pay for that one order and see its summary — nothing else.
 */
export function payToken(orderId: string): string {
  const secret = process.env.JWT_SECRET || "";
  return crypto.createHmac("sha256", secret).update(`pay:${orderId}`).digest("base64url").slice(0, 32);
}
export function validPayToken(orderId: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(payToken(orderId));
  const b = Buffer.from(token);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export function payLink(orderId: string, base = siteUrl()): string {
  return `${base}/pay/${orderId}?k=${payToken(orderId)}`;
}

type PayableOrder = {
  id: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  paymentMethod: string;
  total: number;
  codBalanceDue: number;
  cashfreeOrderId: string | null;
};

/** What is collected online: the whole order, or just the COD confirmation slice. */
export function onlineAmountDue(o: { paymentMethod: string; total: number; codBalanceDue: number }): number {
  return o.paymentMethod === "cod" ? o.total - o.codBalanceDue : o.total;
}

export type PaymentStart =
  | { gateway: "razorpay"; razorpay: { orderId: string; amount: number; currency: string; keyId: string | undefined } }
  | { gateway: "cashfree"; cashfree: { paymentSessionId: string; mode: CashfreeMode; orderId: string } };

export class AlreadyPaidError extends Error {
  constructor() {
    super("This order is already paid.");
    this.name = "AlreadyPaidError";
  }
}

/** Our order id → the Cashfree order id for the next attempt ("<id>", then "<id>-2", "<id>-3"…). */
function nextCashfreeAttempt(orderId: string, current: string | null): string {
  if (!current) return orderId;
  const n = Number(current.split("-")[1] || "1");
  return `${orderId}-${n + 1}`;
}

/** Which of our orders a Cashfree order id belongs to (our ids never contain "-"). */
export function orderIdFromCashfree(cfOrderId: string): string {
  return cfOrderId.split("-")[0];
}

/**
 * Opens a payment for the amount due on this order at the chosen gateway and
 * returns what the browser needs to show the gateway's checkout.
 */
export async function startOnlinePayment(order: PayableOrder, gateway: Gateway, origin: string): Promise<PaymentStart> {
  const amount = onlineAmountDue(order);
  if (amount < 1) throw new Error("There is nothing to pay online for this order.");
  const ref = `#${order.id.slice(-6).toUpperCase()}`;

  if (gateway === "razorpay") {
    const rp = await razorpay().orders.create({
      amount: amount * 100,
      currency: "INR",
      receipt: order.id,
      notes: { orderId: order.id, customer: order.customerPhone, kind: order.paymentMethod === "cod" ? "cod-confirmation" : "full" },
    });
    await prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId: rp.id } });
    return { gateway, razorpay: { orderId: rp.id, amount: Number(rp.amount), currency: rp.currency, keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID } };
  }

  // Reuse an attempt that can still be paid: opening a second one while the
  // first might yet succeed is how customers end up paying twice.
  if (order.cashfreeOrderId) {
    const existing = await getCashfreeOrder(order.cashfreeOrderId).catch(() => null);
    if (existing?.order_status === "PAID") throw new AlreadyPaidError();
    if (existing?.order_status === "ACTIVE" && Number(existing.order_amount) === amount && existing.payment_session_id) {
      return { gateway, cashfree: { paymentSessionId: existing.payment_session_id, mode: cashfreeMode(), orderId: existing.order_id } };
    }
  }
  const attempt = nextCashfreeAttempt(order.id, order.cashfreeOrderId);
  const cf = await createCashfreeOrder({
    orderId: attempt,
    amount,
    customer: { id: order.customerId ?? order.id, phone: order.customerPhone, name: order.customerName },
    returnUrl: payLink(order.id, origin),
    notifyUrl: `${origin}/api/webhooks/cashfree`,
    note: `Ela & Co. order ${ref}${order.paymentMethod === "cod" ? " (COD confirmation)" : ""}`,
    tags: { ela_order: order.id },
  });
  if (!cf.payment_session_id) throw new Error("Cashfree did not return a payment session.");
  await prisma.order.update({ where: { id: order.id }, data: { cashfreeOrderId: attempt } });
  return { gateway, cashfree: { paymentSessionId: cf.payment_session_id, mode: cashfreeMode(), orderId: attempt } };
}

export type SettleResult = { ok: true; order: Awaited<ReturnType<typeof finalizeOrder>>; already: boolean } | { ok: false; reason: "not_found" | "amount_mismatch" };

/**
 * Records a gateway-confirmed payment, exactly once: the order moves to paid
 * (PARTIAL for a COD confirmation), gets its invoice number, reserves stock,
 * and the customer and staff are told. Replays — a retried webhook, a second
 * verify — change nothing and notify no one. Money short of what is due never
 * marks an order paid.
 */
export async function settleOrderPayment(opts: {
  orderId: string;
  gateway: Gateway;
  paymentId: string;
  /** Rupees the gateway says were collected. */
  amount: number;
  via: "checkout" | "webhook" | "pay-page" | "admin-check";
  actor: AuditActor;
  req?: Request;
}): Promise<SettleResult> {
  const order = await prisma.order.findUnique({ where: { id: opts.orderId } });
  if (!order) return { ok: false, reason: "not_found" };
  const isCodConfirmation = order.paymentMethod === "cod" && order.codBalanceDue > 0;
  const due = onlineAmountDue(order);

  if (opts.amount + 0.001 < due) {
    await audit({
      actor: opts.actor,
      action: "order.payment_mismatch",
      entityType: "order",
      entityId: order.id,
      summary: `${GATEWAY_LABEL[opts.gateway]} reported ₹${opts.amount} for order #${order.id.slice(-6).toUpperCase()}, but ₹${due} is due — not marked paid`,
      metadata: { gateway: opts.gateway, paymentId: opts.paymentId, amount: opts.amount, due, via: opts.via },
      req: opts.req,
    });
    return { ok: false, reason: "amount_mismatch" };
  }

  const ids = opts.gateway === "razorpay" ? { razorpayPaymentId: opts.paymentId } : { cashfreePaymentId: opts.paymentId };
  const moved = await prisma.order.updateMany({
    where: { id: order.id, paymentStatus: { in: ["UNPAID", "FAILED"] } },
    data: {
      paymentStatus: isCodConfirmation ? "PARTIAL" : "PAID",
      // Only an order still waiting for payment moves to "confirmed"; one staff
      // already moved on, or cancelled, keeps its status.
      ...(order.status === "PENDING" ? { status: "PLACED", statusChangedAt: new Date() } : {}),
      codConfirmPaid: isCodConfirmation ? due : 0,
      ...ids,
    },
  });

  if (moved.count === 0) {
    const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    const known = opts.gateway === "razorpay" ? current.razorpayPaymentId : current.cashfreePaymentId;
    if (known && known !== opts.paymentId) {
      await audit({
        actor: opts.actor,
        action: "order.duplicate_payment",
        entityType: "order",
        entityId: order.id,
        summary: `Second payment ${opts.paymentId} (₹${opts.amount}) received for already-paid order #${order.id.slice(-6).toUpperCase()} — refund it from the ${GATEWAY_LABEL[opts.gateway]} dashboard`,
        metadata: { gateway: opts.gateway, paymentId: opts.paymentId, firstPaymentId: known, amount: opts.amount },
        req: opts.req,
      });
    }
    return { ok: true, order: current, already: true };
  }

  const updated = await finalizeOrder(order.id);
  const ref = `#${order.id.slice(-6).toUpperCase()}`;
  await audit({
    actor: opts.actor,
    action: "order.paid",
    entityType: "order",
    entityId: order.id,
    summary: isCodConfirmation
      ? `COD confirmation of ₹${due} verified (${GATEWAY_LABEL[opts.gateway]}) — ₹${updated.codBalanceDue} due on delivery (${updated.invoiceNo})`
      : `Payment verified — ₹${updated.total} via ${GATEWAY_LABEL[opts.gateway]} (${updated.invoiceNo})`,
    metadata: { gateway: opts.gateway, paymentId: opts.paymentId, collected: due, total: updated.total, balanceDue: updated.codBalanceDue, via: opts.via },
    req: opts.req,
  });

  if (order.status === "CANCELLED") {
    await audit({
      actor: { type: "system", label: "payments" },
      action: "order.paid_after_cancel",
      entityType: "order",
      entityId: order.id,
      summary: `Order ${ref} was paid after it had been cancelled — refund ₹${due} from Orders`,
      metadata: { gateway: opts.gateway, paymentId: opts.paymentId, amount: due },
    });
  } else {
    // Messages go out after the response, so a slow WhatsApp never delays a payment.
    after(async () => {
      await notifyOrderStatus(updated.id, "PENDING");
      await notifyNewOrderToAdmin(updated);
    });
  }
  return { ok: true, order: updated, already: false };
}

/**
 * Reads the order back from Cashfree and records the payment if Cashfree says
 * it is PAID. Safe to call any number of times.
 */
export async function confirmCashfreePayment(
  order: { id: string; cashfreeOrderId: string | null },
  actor: AuditActor,
  via: "checkout" | "pay-page" | "admin-check",
  req?: Request,
): Promise<{ paid: boolean; status: string; order?: Awaited<ReturnType<typeof finalizeOrder>> }> {
  if (!order.cashfreeOrderId) return { paid: false, status: "NO_PAYMENT" };
  const cf = await getCashfreeOrder(order.cashfreeOrderId);
  if (cf.order_status !== "PAID") {
    const payments = await getCashfreePayments(order.cashfreeOrderId).catch(() => []);
    const last = payments[0];
    return { paid: false, status: last?.payment_status === "FAILED" || last?.payment_status === "USER_DROPPED" ? "FAILED" : cf.order_status };
  }
  const success = (await getCashfreePayments(order.cashfreeOrderId)).find((p) => p.payment_status === "SUCCESS");
  if (!success) return { paid: false, status: "PENDING" };
  const r = await settleOrderPayment({ orderId: order.id, gateway: "cashfree", paymentId: String(success.cf_payment_id), amount: Number(success.payment_amount), via, actor, req });
  return r.ok ? { paid: true, status: "PAID", order: r.order } : { paid: false, status: r.reason.toUpperCase() };
}

export class RefundError extends Error {
  constructor(
    message: string,
    public httpStatus = 400,
  ) {
    super(message);
    this.name = "RefundError";
  }
}

/**
 * Pays back what was collected online for an order (spec #12) — through the
 * gateway, or recorded as already refunded by hand. One refund per order: the
 * claim on the order row is taken first, so a double click cannot refund twice.
 */
export async function refundOrder(opts: { orderId: string; manual: boolean; note: string; actor: AuditActor; req?: Request }) {
  const order = await prisma.order.findUnique({ where: { id: opts.orderId } });
  if (!order) throw new RefundError("Order not found", 404);
  if (order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIAL") throw new RefundError("Only a paid order can be refunded.", 409);
  const amount = order.paymentStatus === "PARTIAL" ? order.codConfirmPaid : onlineAmountDue(order);
  if (amount < 1) throw new RefundError("Nothing was paid online for this order.", 409);
  const gateway: Gateway | null = order.cashfreePaymentId ? "cashfree" : order.razorpayPaymentId ? "razorpay" : null;
  if (!opts.manual && !gateway) throw new RefundError("This order wasn't paid through a gateway — record the refund manually instead.", 409);

  const claimed = await prisma.order.updateMany({
    where: { id: order.id, OR: [{ refundStatus: null }, { refundStatus: "FAILED" }] },
    data: { refundStatus: "REQUESTED", refundAmount: amount, refundNote: opts.note || null },
  });
  if (claimed.count === 0) throw new RefundError("A refund has already been started for this order.", 409);

  const ref = `#${order.id.slice(-6).toUpperCase()}`;
  let status: "SUCCESS" | "PENDING" | "MANUAL";
  let refundId: string | null = null;
  try {
    if (opts.manual) {
      status = "MANUAL";
    } else if (gateway === "cashfree") {
      refundId = `rf-${order.id}`;
      const r = await createCashfreeRefund(order.cashfreeOrderId!, { refundId, amount, note: opts.note || `Refund for order ${ref}` });
      status = r.refund_status === "SUCCESS" ? "SUCCESS" : "PENDING";
    } else {
      const r = (await razorpay().payments.refund(order.razorpayPaymentId!, { amount: amount * 100, notes: { orderId: order.id } })) as { id: string; status?: string };
      refundId = r.id;
      status = r.status === "processed" ? "SUCCESS" : "PENDING";
    }
  } catch (e) {
    const msg = (e as { error?: { description?: string } })?.error?.description || (e as Error).message || "Refund failed";
    await prisma.order.update({ where: { id: order.id }, data: { refundStatus: "FAILED" } });
    await audit({ actor: opts.actor, action: "order.refund_failed", entityType: "order", entityId: order.id, summary: `Refund of ₹${amount} for ${ref} failed: ${msg}`, metadata: { gateway, amount }, req: opts.req });
    throw new RefundError(`The refund didn't go through: ${msg}`, 502);
  }

  const done = status !== "PENDING";
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { refundStatus: status, refundId, ...(done ? { paymentStatus: "REFUNDED", refundedAt: new Date() } : {}) },
    include: { items: true },
  });
  await audit({
    actor: opts.actor,
    action: opts.manual ? "order.refund_recorded" : "order.refunded",
    entityType: "order",
    entityId: order.id,
    summary: opts.manual
      ? `Refund of ₹${amount} for ${ref} recorded as done outside the system`
      : `Refund of ₹${amount} for ${ref} ${done ? "completed" : "started"} via ${GATEWAY_LABEL[gateway!]}`,
    metadata: { gateway, amount, refundId, status, note: opts.note || null },
    req: opts.req,
  });
  return updated;
}

/** A gateway's later word on a refund (webhook): settles a PENDING refund either way. */
export async function applyRefundUpdate(orderId: string, outcome: "SUCCESS" | "FAILED", detail?: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || (order.refundStatus !== "PENDING" && order.refundStatus !== "REQUESTED")) return false;
  await prisma.order.update({
    where: { id: orderId },
    data: outcome === "SUCCESS" ? { refundStatus: "SUCCESS", paymentStatus: "REFUNDED", refundedAt: new Date() } : { refundStatus: "FAILED" },
  });
  await audit({
    actor: { type: "system", label: "payment-webhook" },
    action: outcome === "SUCCESS" ? "order.refunded" : "order.refund_failed",
    entityType: "order",
    entityId: orderId,
    summary: `Refund for #${orderId.slice(-6).toUpperCase()} ${outcome === "SUCCESS" ? "completed" : `failed${detail ? `: ${detail}` : ""}`}`,
  });
  return true;
}

/**
 * Why an unpaid order can no longer be paid for, if it can't: its delivery
 * time has passed, or a dish sold out or was taken off the menu meanwhile.
 * Checked before every payment attempt, so nobody pays for food we can't send.
 */
export async function paymentBlocker(orderId: string): Promise<string | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: { include: { menuItem: true } }, deliverySlot: true } });
  if (!order) return "Order not found.";
  if (order.status === "CANCELLED") return "This order was cancelled.";
  if (order.deliveryDate) {
    const day = dateKeyFromDb(order.deliveryDate);
    const today = istDateKey();
    if (day < today || (day === today && order.deliverySlot && order.deliverySlot.startMinutes <= istMinutesNow())) {
      return "The delivery time chosen for this order has passed. Please place a new order.";
    }
  }
  for (const it of order.items) {
    const m = it.menuItem;
    if (!m) continue;
    if (!m.available) return `Sorry, “${m.name}” is no longer available. Please place a new order.`;
    if (m.stock !== null && m.stock < it.qty) return m.stock <= 0 ? `Sorry, “${m.name}” just sold out.` : `Sorry, only ${m.stock} × “${m.name}” left.`;
  }
  return null;
}
