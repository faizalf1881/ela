import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { cashfreeConfigured, verifyCashfreeWebhook } from "@/lib/cashfree";
import { applyRefundUpdate, orderIdFromCashfree, settleOrderPayment } from "@/lib/payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/cashfree — Cashfree's server-to-server payment events.
 *
 * Every event must carry a valid x-webhook-signature (HMAC of the timestamp +
 * raw body with the Secret Key), so a forged "payment success" is rejected.
 * Each order sets this URL as its notify_url, so nothing needs configuring in
 * the dashboard; adding it under Developers → Webhooks as well is harmless —
 * every event is applied at most once.
 */
type Payload = {
  type?: string;
  data?: {
    order?: { order_id?: string; order_amount?: number | string; order_tags?: Record<string, string> | null };
    payment?: { cf_payment_id?: string | number; payment_status?: string; payment_amount?: number | string; payment_message?: string };
    refund?: { refund_id?: string; order_id?: string; refund_status?: string; status_description?: string };
  };
};

export async function POST(req: Request) {
  const raw = await req.text();
  if (!cashfreeConfigured()) {
    // eslint-disable-next-line no-console
    console.error("[Cashfree webhook] Cashfree keys are not set — refusing unverifiable events.");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  if (!verifyCashfreeWebhook(raw, req.headers.get("x-webhook-signature"), req.headers.get("x-webhook-timestamp"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: Payload;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const type = event.type || "";
  const cfOrderId = event.data?.order?.order_id || event.data?.refund?.order_id || "";
  const orderId = event.data?.order?.order_tags?.ela_order || (cfOrderId ? orderIdFromCashfree(cfOrderId) : "");
  const order = orderId ? await prisma.order.findUnique({ where: { id: orderId } }) : null;
  if (!order) return NextResponse.json({ ok: true, unknown: cfOrderId || null });

  const actor = { type: "system", label: "cashfree-webhook" };
  switch (type) {
    case "PAYMENT_SUCCESS_WEBHOOK": {
      const p = event.data?.payment;
      if (p?.payment_status !== "SUCCESS" || p.cf_payment_id === undefined) return NextResponse.json({ ok: true, ignored: "not a success" });
      const r = await settleOrderPayment({ orderId: order.id, gateway: "cashfree", paymentId: String(p.cf_payment_id), amount: Number(p.payment_amount), via: "webhook", actor, req });
      return NextResponse.json({ ok: true, settled: r.ok, already: r.ok ? r.already : undefined });
    }
    case "PAYMENT_FAILED_WEBHOOK":
    case "PAYMENT_USER_DROPPED_WEBHOOK": {
      // Only an unpaid order is marked failed; the customer may still retry and pay.
      const moved = await prisma.order.updateMany({ where: { id: order.id, paymentStatus: "UNPAID" }, data: { paymentStatus: "FAILED" } });
      if (moved.count) {
        await audit({
          actor,
          action: "order.payment_failed",
          entityType: "order",
          entityId: order.id,
          summary: `Cashfree payment ${type === "PAYMENT_USER_DROPPED_WEBHOOK" ? "abandoned" : "failed"}${event.data?.payment?.payment_message ? `: ${event.data.payment.payment_message}` : ""}`,
          metadata: { cfOrderId, paymentId: event.data?.payment?.cf_payment_id ?? null },
        });
      }
      return NextResponse.json({ ok: true });
    }
    case "REFUND_STATUS_WEBHOOK": {
      const status = event.data?.refund?.refund_status;
      if (status === "SUCCESS") await applyRefundUpdate(order.id, "SUCCESS");
      else if (status === "CANCELLED" || status === "REJECTED") await applyRefundUpdate(order.id, "FAILED", event.data?.refund?.status_description);
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ ok: true, ignored: type });
  }
}
