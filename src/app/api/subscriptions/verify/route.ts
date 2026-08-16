import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { verifySubscriptionSignature } from "@/lib/razorpay";
import { addCycle } from "@/lib/membership";
import { audit, actorFrom } from "@/lib/audit";
import { notifyTicket } from "@/lib/notify";

export const runtime = "nodejs";

const schema = z.object({
  razorpay_subscription_id: z.string().trim().min(1),
  razorpay_payment_id: z.string().trim().min(1),
  razorpay_signature: z.string().trim().min(1),
});

// POST /api/subscriptions/verify — activate a membership after the customer
// authorises the mandate in Razorpay checkout.
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "customer") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payment response" }, { status: 400 });
  const { razorpay_subscription_id, razorpay_payment_id, razorpay_signature } = parsed.data;

  const valid = verifySubscriptionSignature({
    subscriptionId: razorpay_subscription_id,
    paymentId: razorpay_payment_id,
    signature: razorpay_signature,
  });
  if (!valid) {
    await audit({
      actor: actorFrom(s),
      action: "subscription.verify_failed",
      entityType: "subscription",
      summary: `Invalid subscription signature for ${razorpay_subscription_id}`,
      req,
    });
    return NextResponse.json({ error: "Payment verification failed" }, { status: 400 });
  }

  const sub = await prisma.subscription.findUnique({
    where: { razorpaySubscriptionId: razorpay_subscription_id },
    include: { plan: true },
  });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  if (sub.customerId !== s.sub) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const renews = addCycle(now, sub.plan.interval, sub.plan.intervalCount);

  const updated = await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status: "ACTIVE",
      razorpayPaymentId: razorpay_payment_id,
      startedAt: sub.startedAt ?? now,
      currentEnd: renews,
    },
    include: { plan: true },
  });

  // Record the first charge (idempotent on the payment id).
  await prisma.subscriptionCharge
    .create({ data: { subscriptionId: sub.id, amount: sub.plan.price, razorpayPaymentId: razorpay_payment_id } })
    .catch(() => {});

  await audit({
    actor: actorFrom(s),
    action: "subscription.activated",
    entityType: "subscription",
    entityId: sub.id,
    summary: `Membership "${sub.plan.name}" activated (₹${sub.plan.price})`,
    metadata: { razorpaySubscriptionId: razorpay_subscription_id, razorpayPaymentId: razorpay_payment_id, renewsAt: renews },
    req,
  });

  const customer = await prisma.customer.findUnique({ where: { id: sub.customerId } });
  if (customer) {
    await notifyTicket(
      customer.phone,
      `🌟 Welcome to *${sub.plan.name}*! Your Ela & Co. membership is active. Renews on ${renews.toLocaleDateString("en-IN")}.`,
    );
  }

  return NextResponse.json({ subscription: updated });
}
