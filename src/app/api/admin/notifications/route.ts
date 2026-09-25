import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["PENDING", "SENT", "FAILED", "SKIPPED"] as const;

/**
 * GET /api/admin/notifications — the WhatsApp order-update log (spec #46).
 * Staff (admin + kitchen) can see it, so a failed message can be followed up.
 * ?status=FAILED|SENT|SKIPPED|PENDING  ?orderId=  ?q= (customer, phone, order)
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || (s.role !== "admin" && s.role !== "kitchen")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "";
  const orderId = searchParams.get("orderId") || "";
  const q = searchParams.get("q")?.trim() || "";
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

  const where: Prisma.OrderNotificationWhereInput = {};
  if ((STATUSES as readonly string[]).includes(status)) where.status = status as (typeof STATUSES)[number];
  if (orderId) where.orderId = orderId;
  if (q) {
    const ref = q.replace(/^#/, "").toLowerCase();
    where.OR = [
      { customerName: { contains: q, mode: "insensitive" } },
      { phone: { contains: q.replace(/\D/g, "") || q } },
      { orderId: { endsWith: ref } },
      { order: { invoiceNo: { equals: q.toUpperCase() } } },
    ];
  }

  const since = new Date(Date.now() - 24 * 60 * 60_000);
  const [notifications, total, failed24h] = await Promise.all([
    prisma.orderNotification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      include: { order: { select: { id: true, invoiceNo: true, status: true } } },
    }),
    prisma.orderNotification.count({ where }),
    prisma.orderNotification.count({ where: { status: "FAILED", createdAt: { gte: since } } }),
  ]);

  return NextResponse.json({ notifications, total, failed24h });
}
