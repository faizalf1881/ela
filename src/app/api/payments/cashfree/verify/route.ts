import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { confirmCashfreePayment } from "@/lib/payments";

export const runtime = "nodejs";

const schema = z.object({ orderId: z.string().min(1).max(60) });

/**
 * POST /api/payments/cashfree/verify — after the Cashfree checkout closes.
 * What the browser reports is ignored: the order is read back from Cashfree's
 * API and is only marked paid if Cashfree says it is PAID for the full amount.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "customer") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const order = await prisma.order.findFirst({ where: { id: parsed.data.orderId, customerId: s.sub } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIAL") {
    const current = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
    return NextResponse.json({ paid: true, order: current, alreadyVerified: true });
  }

  try {
    const r = await confirmCashfreePayment(order, actorFrom(s), "checkout", req);
    if (r.paid) return NextResponse.json({ paid: true, order: r.order });
    return NextResponse.json({ paid: false, status: r.status, pending: r.status === "PENDING" });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[Cashfree] verify failed:", order.id, e);
    return NextResponse.json({ paid: false, pending: true, error: "We couldn't confirm the payment yet. If money was taken, your order will be confirmed automatically." }, { status: 502 });
  }
}
