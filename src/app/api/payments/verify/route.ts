import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { onlineAmountDue, settleOrderPayment } from "@/lib/payments";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "customer") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    razorpay_order_id?: string;
    razorpay_payment_id?: string;
    razorpay_signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });
  }

  const valid = verifyPaymentSignature({
    orderId: razorpay_order_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });

  if (!valid) {
    // Signature mismatch — do NOT mark as paid.
    // Only an unpaid order can be marked failed — a bad or replayed callback
    // must never downgrade an order that was already paid.
    await prisma.order.updateMany({
      where: { razorpayOrderId: razorpay_order_id, customerId: s.sub, paymentStatus: "UNPAID" },
      data: { paymentStatus: "FAILED" },
    });
    await audit({ actor: actorFrom(s), action: "order.payment_failed", entityType: "order", summary: "Payment signature verification FAILED", metadata: { razorpay_order_id, razorpay_payment_id }, req });
    return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
  }

  const order = await prisma.order.findFirst({
    where: { razorpayOrderId: razorpay_order_id, customerId: s.sub },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // The signature proves Razorpay took the payment for this Razorpay order,
  // whose amount we fixed when creating it. A retried or doubled callback is
  // confirmed without touching the order again or messaging anyone twice.
  const r = await settleOrderPayment({
    orderId: order.id,
    gateway: "razorpay",
    paymentId: razorpay_payment_id,
    amount: onlineAmountDue(order),
    gatewayOrderId: razorpay_order_id,
    via: "checkout",
    actor: actorFrom(s),
    req,
  });
  if (!r.ok) return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
  return NextResponse.json({ ok: true, order: r.order, ...(r.already ? { alreadyVerified: true } : {}) });
}
