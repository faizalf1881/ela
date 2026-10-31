import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { onlineAmountDue, reconcilePayment, settleOrderPayment, validPayToken } from "@/lib/payments";

export const runtime = "nodejs";

const schema = z.object({
  k: z.string().max(64),
  razorpay_order_id: z.string().max(80).optional(),
  razorpay_payment_id: z.string().max(80).optional(),
  razorpay_signature: z.string().max(200).optional(),
});

/**
 * POST /api/pay/[id]/confirm — after the gateway checkout on the payment-link
 * page. Paid only on a valid Razorpay signature for this order's Razorpay
 * order, or when the gateway's own API reports the payment.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !validPayToken(id, parsed.data.k)) return NextResponse.json({ error: "This payment link isn't valid." }, { status: 403 });
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIAL") return NextResponse.json({ paid: true });

  const actor = { type: "customer", id: order.customerId ?? undefined, label: order.customerPhone };
  const b = parsed.data;
  if (b.razorpay_order_id || b.razorpay_payment_id) {
    const valid =
      !!b.razorpay_order_id &&
      !!b.razorpay_payment_id &&
      !!b.razorpay_signature &&
      b.razorpay_order_id === order.razorpayOrderId &&
      verifyPaymentSignature({ orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature });
    if (!valid) return NextResponse.json({ paid: false, error: "Payment verification failed." }, { status: 400 });
    const r = await settleOrderPayment({ orderId: order.id, gateway: "razorpay", paymentId: b.razorpay_payment_id!, amount: onlineAmountDue(order), gatewayOrderId: b.razorpay_order_id, via: "pay-page", actor, req });
    return NextResponse.json({ paid: r.ok });
  }

  try {
    const r = await reconcilePayment(order, actor, "pay-page", req);
    return NextResponse.json({ paid: r.paid, status: r.status });
  } catch {
    return NextResponse.json({ paid: false, status: "PENDING", error: "We couldn't confirm the payment yet. If money was taken, your order is confirmed automatically." }, { status: 502 });
  }
}
