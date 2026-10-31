import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { activeGateway, AlreadyPaidError, confirmCashfreePayment, onlineAmountDue, paymentBlocker, startOnlinePayment, validPayToken } from "@/lib/payments";

export const runtime = "nodejs";

const schema = z.object({ k: z.string().max(64) });

/**
 * POST /api/pay/[id] — start paying for one order from its payment link
 * (/pay/<id>?k=…, sent on WhatsApp). The link's key is the only credential:
 * it opens a payment for exactly this order's amount and nothing else.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !validPayToken(id, parsed.data.k)) return NextResponse.json({ error: "This payment link isn't valid." }, { status: 403 });

  const order = await prisma.order.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIAL" || order.paymentStatus === "REFUNDED") {
    return NextResponse.json({ error: "This order is already paid.", paid: true }, { status: 409 });
  }
  if (onlineAmountDue(order) < 1) return NextResponse.json({ error: "There is nothing to pay online for this order." }, { status: 409 });
  const blocker = await paymentBlocker(order.id);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

  const gateway = await activeGateway();
  if (!gateway) return NextResponse.json({ error: "Online payment isn't available right now. Please try again later." }, { status: 503 });
  try {
    const start = await startOnlinePayment(order, gateway, new URL(req.url).origin);
    return NextResponse.json({ ...start, amount: onlineAmountDue(order), prefill: { name: order.customerName, contact: order.customerPhone } });
  } catch (e) {
    if (e instanceof AlreadyPaidError) {
      await confirmCashfreePayment(order, { type: "customer", label: order.customerPhone }, "pay-page", req).catch(() => null);
      return NextResponse.json({ error: "This order is already paid.", paid: true }, { status: 409 });
    }
    // eslint-disable-next-line no-console
    console.error(`[pay] could not start ${gateway} payment:`, id, e);
    return NextResponse.json({ error: "Could not open the payment page. Please try again." }, { status: 502 });
  }
}
