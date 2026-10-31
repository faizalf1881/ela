import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { humanDate, dateKeyFromDb } from "@/lib/delivery";
import { activeGateway, GATEWAY_LABEL, onlineAmountDue, paymentBlocker, reconcilePayment, validPayToken } from "@/lib/payments";
import { PayView, type PayOrder } from "@/components/site/PayView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pay for your order", robots: { index: false, follow: false } };

async function load(id: string) {
  return prisma.order.findUnique({ where: { id }, include: { items: true, deliverySlot: true } });
}

/**
 * /pay/<order id>?k=<key> — the payment link sent on WhatsApp (spec #10/#11),
 * and where Cashfree returns the customer after paying. On every visit an
 * unpaid order is checked with the gateway directly, so the page shows the
 * gateway's verdict — never the customer's word for it.
 */
export default async function PayPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ k?: string }> }) {
  const { id } = await params;
  const { k } = await searchParams;
  let order = validPayToken(id, k) ? await load(id) : null;

  if (order && (order.paymentStatus === "UNPAID" || order.paymentStatus === "FAILED") && (order.cashfreeOrderId || order.razorpayOrderId)) {
    const r = await reconcilePayment(order, { type: "customer", id: order.customerId ?? undefined, label: order.customerPhone }, "pay-page").catch(() => null);
    if (r?.paid) order = await load(id);
  }

  if (!order) return <PayView order={null} token="" blocker={null} gatewayLabel={null} />;

  const unpaid = order.paymentStatus === "UNPAID" || order.paymentStatus === "FAILED";
  const [blocker, gateway] = await Promise.all([unpaid ? paymentBlocker(order.id) : null, activeGateway()]);
  const dto: PayOrder = {
    id: order.id,
    ref: `#${order.id.slice(-6).toUpperCase()}`,
    customerName: order.customerName,
    items: order.items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
    subtotal: order.subtotal,
    savings: order.couponDiscount + order.membershipDiscount,
    deliveryFee: order.deliveryFee,
    total: order.total,
    amountDue: onlineAmountDue(order),
    codBalanceDue: order.paymentMethod === "cod" ? order.codBalanceDue : 0,
    paymentStatus: order.paymentStatus,
    status: order.status,
    delivery: [order.deliveryDate ? humanDate(dateKeyFromDb(order.deliveryDate)) : null, order.deliverySlot?.label].filter(Boolean).join(" · ") || null,
    address: order.address,
  };
  return <PayView order={dto} token={k!} blocker={blocker} gatewayLabel={gateway ? GATEWAY_LABEL[gateway] : null} />;
}
