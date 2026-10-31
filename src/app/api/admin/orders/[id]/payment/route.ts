import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { confirmCashfreePayment, onlineAmountDue, payLink } from "@/lib/payments";

export const runtime = "nodejs";

/**
 * GET /api/admin/orders/[id]/payment — the order's payment link (to copy or
 * resend) for staff. POST — ask the gateway whether an unpaid order has been
 * paid after all (e.g. the customer closed the page before it confirmed).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || (s.role !== "admin" && s.role !== "kitchen")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ link: payLink(order.id, new URL(_req.url).origin), amountDue: onlineAmountDue(order), paymentStatus: order.paymentStatus });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIAL") return NextResponse.json({ paid: true, status: "PAID" });
  if (!order.cashfreeOrderId) {
    return NextResponse.json({ paid: false, status: order.razorpayOrderId ? "CHECK_DASHBOARD" : "NO_PAYMENT" });
  }
  try {
    const r = await confirmCashfreePayment(order, actorFrom(s), "admin-check", req);
    return NextResponse.json({ paid: r.paid, status: r.status });
  } catch (e) {
    return NextResponse.json({ error: `Could not reach Cashfree: ${(e as Error).message}` }, { status: 502 });
  }
}
