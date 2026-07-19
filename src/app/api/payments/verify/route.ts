import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { verifyPaymentSignature } from "@/lib/razorpay";
import { finalizeOrder } from "@/lib/fulfillment";
import { notifyOrderStatus, notifyNewOrderToAdmin } from "@/lib/notify";
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
    await prisma.order.updateMany({
      where: { razorpayOrderId: razorpay_order_id, customerId: s.sub },
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

  await prisma.order.update({
    where: { id: order.id },
    data: {
      paymentStatus: "PAID",
      status: "PLACED",
      razorpayPaymentId: razorpay_payment_id,
    },
  });

  // Assign invoice number + decrement stock (idempotent).
  const updated = await finalizeOrder(order.id);
  await audit({ actor: actorFrom(s), action: "order.paid", entityType: "order", entityId: order.id, summary: `Payment verified — ₹${updated.total} (${updated.invoiceNo})`, metadata: { razorpay_order_id, razorpay_payment_id, total: updated.total }, req });
  await notifyOrderStatus(updated);
  await notifyNewOrderToAdmin(updated);

  return NextResponse.json({ ok: true, order: updated });
}
