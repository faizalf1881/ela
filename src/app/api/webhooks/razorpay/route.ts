import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { addCycle } from "@/lib/membership";
import { audit } from "@/lib/audit";
import { settleOrderPayment } from "@/lib/payments";

export const runtime = "nodejs";

type RzpSubscriptionEntity = { id: string; current_end?: number; status?: string };
type RzpPaymentEntity = { id: string; amount?: number; status?: string; order_id?: string };
type RzpOrderEntity = { id: string; notes?: Record<string, string> | null };

/**
 * POST /api/webhooks/razorpay — recurring-billing events.
 * Keeps memberships in sync when Razorpay auto-charges (or fails to charge)
 * the customer's mandate. Configure this URL + RAZORPAY_WEBHOOK_SECRET in the
 * Razorpay dashboard with the subscription.* events enabled — and order.paid,
 * so an order is confirmed even if the customer closes the page right after
 * paying.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: {
    event?: string;
    payload?: {
      subscription?: { entity?: RzpSubscriptionEntity };
      payment?: { entity?: RzpPaymentEntity };
      order?: { entity?: RzpOrderEntity };
    };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  const name = event.event || "";

  // A one-off order payment. The order is found from what we set on the server
  // (the Razorpay order's notes, or its id) — never from payment notes, which
  // the paying browser can choose.
  if (name === "order.paid" || name === "payment.captured") {
    const pay = event.payload?.payment?.entity;
    const rzpOrder = event.payload?.order?.entity;
    const rzpOrderId = rzpOrder?.id || pay?.order_id;
    if (!pay?.id || pay.status !== "captured" || !rzpOrderId) return NextResponse.json({ ok: true, ignored: name });
    const ours = rzpOrder?.notes?.orderId
      ? await prisma.order.findUnique({ where: { id: rzpOrder.notes.orderId } })
      : await prisma.order.findFirst({ where: { razorpayOrderId: rzpOrderId } });
    if (!ours) return NextResponse.json({ ok: true, unknown: rzpOrderId });
    const r = await settleOrderPayment({
      orderId: ours.id,
      gateway: "razorpay",
      paymentId: pay.id,
      amount: Number(pay.amount ?? 0) / 100,
      gatewayOrderId: rzpOrderId,
      via: "webhook",
      actor: { type: "system", label: "razorpay-webhook" },
      req,
    });
    return NextResponse.json({ ok: true, settled: r.ok, already: r.ok ? r.already : undefined });
  }

  const rzpSub = event.payload?.subscription?.entity;
  const rzpPayment = event.payload?.payment?.entity;
  if (!rzpSub?.id) return NextResponse.json({ ok: true, ignored: name });

  const sub = await prisma.subscription.findUnique({
    where: { razorpaySubscriptionId: rzpSub.id },
    include: { plan: true },
  });
  if (!sub) return NextResponse.json({ ok: true, unknown: rzpSub.id });

  const renews = rzpSub.current_end
    ? new Date(rzpSub.current_end * 1000)
    : addCycle(new Date(), sub.plan.interval, sub.plan.intervalCount);

  switch (name) {
    case "subscription.charged": {
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: "ACTIVE", currentEnd: renews, startedAt: sub.startedAt ?? new Date() },
      });
      if (rzpPayment?.id) {
        // Unique on razorpayPaymentId → replayed webhooks can't double-record.
        await prisma.subscriptionCharge
          .create({
            data: {
              subscriptionId: sub.id,
              amount: rzpPayment.amount ? Math.round(rzpPayment.amount / 100) : sub.plan.price,
              razorpayPaymentId: rzpPayment.id,
            },
          })
          .catch(() => {});
      }
      break;
    }
    case "subscription.halted":
    case "subscription.paused":
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "PAUSED" } });
      break;
    case "subscription.cancelled":
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      break;
    case "subscription.completed":
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "EXPIRED" } });
      break;
    case "subscription.activated":
    case "subscription.resumed":
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", currentEnd: renews } });
      break;
    default:
      return NextResponse.json({ ok: true, ignored: name });
  }

  await audit({
    actor: { type: "system", label: "razorpay-webhook" },
    action: `subscription.webhook.${name.replace("subscription.", "")}`,
    entityType: "subscription",
    entityId: sub.id,
    summary: `Razorpay webhook: ${name}`,
    metadata: { razorpaySubscriptionId: rzpSub.id, paymentId: rzpPayment?.id ?? null },
    req,
  });

  return NextResponse.json({ ok: true });
}
