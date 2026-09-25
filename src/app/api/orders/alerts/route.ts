import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// With no `since`, the device is just starting to listen: hand back the recent
// orders so it can mark them as already seen (they must not alert).
const BASELINE_MS = 10 * 60_000;
// Never look further back than a day, however long a screen was closed.
const MAX_LOOKBACK_MS = 24 * 60 * 60_000;

/**
 * GET /api/orders/alerts?since=<ISO> — staff new-order feed (spec #48–#50).
 *
 * Returns customer orders that became real (COD placed / payment verified)
 * after `since`, oldest first, plus the server clock. The screen decides what
 * to alert on: it remembers what it has shown, so refreshes never replay.
 * Meal-plan and manual invoices are excluded: they are not new customer orders.
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin" && s.role !== "kitchen") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const now = new Date();
  const raw = new URL(req.url).searchParams.get("since");
  const parsed = raw ? new Date(raw) : null;
  const floor = new Date(now.getTime() - MAX_LOOKBACK_MS);
  const since =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed < floor
        ? floor
        : parsed
      : new Date(now.getTime() - BASELINE_MS);

  const orders = await prisma.order.findMany({
    where: { placedAt: { gt: since }, source: "web" },
    orderBy: { placedAt: "asc" },
    take: 25,
    select: {
      id: true,
      invoiceNo: true,
      customerName: true,
      address: true,
      total: true,
      paymentMethod: true,
      paymentStatus: true,
      codBalanceDue: true,
      placedAt: true,
      deliveryDate: true,
      deliverySlot: { select: { label: true } },
      deliveryLocation: { select: { name: true, area: true } },
      items: { select: { name: true, qty: true } },
    },
  });

  return NextResponse.json({ now: now.toISOString(), baseline: !parsed, orders });
}
