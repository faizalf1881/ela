import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

type Range = "daily" | "weekly" | "monthly";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

// Build the bucket boundaries + labels for the requested range.
function buildBuckets(range: Range) {
  const now = new Date();
  const buckets: { start: Date; end: Date; label: string }[] = [];

  if (range === "monthly") {
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ start, end, label: `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}` });
    }
  } else if (range === "weekly") {
    const today = startOfDay(now);
    // start of current week (Monday)
    const dow = (today.getDay() + 6) % 7;
    const thisMonday = addDays(today, -dow);
    for (let i = 7; i >= 0; i--) {
      const start = addDays(thisMonday, -i * 7);
      const end = addDays(start, 7);
      buckets.push({ start, end, label: `${MONTHS[start.getMonth()]} ${start.getDate()}` });
    }
  } else {
    const today = startOfDay(now);
    for (let i = 13; i >= 0; i--) {
      const start = addDays(today, -i);
      const end = addDays(start, 1);
      buckets.push({ start, end, label: `${MONTHS[start.getMonth()]} ${start.getDate()}` });
    }
  }
  return buckets;
}

export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const range = (searchParams.get("range") as Range) || "daily";
  const buckets = buildBuckets(range);
  const windowStart = buckets[0].start;

  // Revenue-generating orders = anything not pending/cancelled.
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: windowStart }, status: { notIn: ["PENDING", "CANCELLED"] } },
    include: { items: true },
    orderBy: { createdAt: "asc" },
  });

  // Time series
  const series = buckets.map((b) => {
    const inBucket = orders.filter((o) => o.createdAt >= b.start && o.createdAt < b.end);
    return {
      label: b.label,
      revenue: inBucket.reduce((n, o) => n + o.total, 0),
      orders: inBucket.length,
    };
  });

  // Summary over window
  const totalRevenue = orders.reduce((n, o) => n + o.total, 0);
  const totalOrders = orders.length;
  const itemsSold = orders.reduce((n, o) => n + o.items.reduce((a, i) => a + i.qty, 0), 0);
  const avgOrder = totalOrders ? Math.round(totalRevenue / totalOrders) : 0;
  const totalSaved = orders.reduce((n, o) => n + o.discountTotal, 0);

  // Top items by quantity
  const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
  for (const o of orders) {
    for (const it of o.items) {
      const cur = itemMap.get(it.name) || { name: it.name, qty: 0, revenue: 0 };
      cur.qty += it.qty;
      cur.revenue += it.price * it.qty;
      itemMap.set(it.name, cur);
    }
  }
  const topItems = [...itemMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);

  // Status breakdown (all-time, quick operational glance)
  const statusRows = await prisma.order.groupBy({ by: ["status"], _count: { _all: true } });
  const statusCounts: Record<string, number> = {};
  for (const r of statusRows) statusCounts[r.status] = r._count._all;

  return NextResponse.json({
    range,
    series,
    summary: { totalRevenue, totalOrders, itemsSold, avgOrder, totalSaved },
    topItems,
    statusCounts,
  });
}
