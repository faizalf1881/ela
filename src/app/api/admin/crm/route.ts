import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

// GET /api/admin/crm — customer directory with order aggregates + history.
export async function GET(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();

  const where: Prisma.CustomerWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] }
    : {};

  const customers = await prisma.customer.findMany({
    where,
    include: {
      orders: {
        orderBy: { createdAt: "desc" },
        select: { id: true, invoiceNo: true, createdAt: true, total: true, paymentMethod: true, paymentStatus: true, status: true },
      },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        include: { plan: { select: { name: true, price: true, interval: true } }, charges: { orderBy: { paidAt: "desc" } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const rows = customers.map((c) => {
    const active = c.orders.filter((o) => o.status !== "CANCELLED");
    const totalSpent = active.reduce((n, o) => n + o.total, 0);
    const methodCounts: Record<string, number> = {};
    for (const o of c.orders) methodCounts[o.paymentMethod] = (methodCounts[o.paymentMethod] || 0) + 1;
    const preferredMethod = Object.entries(methodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    const current = c.orders.filter((o) => ["PLACED", "PREPARING", "OUT_FOR_DELIVERY"].includes(o.status)).length;
    const activeSub = c.subscriptions.find((s) => s.status === "ACTIVE") ?? null;
    const subscriptionPayments = c.subscriptions.flatMap((s) => s.charges);

    return {
      subscriptionStatus: activeSub ? "ACTIVE" : (c.subscriptions[0]?.status ?? "NONE"),
      planName: activeSub?.plan.name ?? c.subscriptions[0]?.plan.name ?? null,
      planPrice: activeSub?.plan.price ?? null,
      planInterval: activeSub?.plan.interval ?? null,
      renewsAt: activeSub?.currentEnd ?? null,
      subscriptionPaid: subscriptionPayments.reduce((n, p) => n + p.amount, 0),
      subscriptionPayments: subscriptionPayments.map((p) => ({ id: p.id, amount: p.amount, paidAt: p.paidAt })),
      id: c.id,
      name: c.name,
      phone: c.phone,
      address: c.address,
      notes: c.notes,
      createdAt: c.createdAt,
      lastLoginAt: c.lastLoginAt,
      totalOrders: c.orders.length,
      currentOrders: current,
      totalSpent,
      lastOrderAt: c.orders[0]?.createdAt ?? null,
      preferredMethod,
      orders: c.orders,
    };
  });

  return NextResponse.json({ customers: rows });
}
