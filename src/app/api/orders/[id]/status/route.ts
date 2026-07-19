import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { notifyOrderStatus } from "@/lib/notify";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

const STATUSES = ["PENDING", "PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"] as const;
const schema = z.object({ status: z.enum(STATUSES) });

// PATCH /api/orders/[id]/status — kitchen + admin.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || (s.role !== "kitchen" && s.role !== "admin")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const before = await prisma.order.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const order = await prisma.order.update({
    where: { id },
    data: { status: parsed.data.status },
    include: { items: true },
  });
  await audit({
    actor: actorFrom(s),
    action: "order.status_changed",
    entityType: "order",
    entityId: id,
    summary: `Order #${id.slice(-6).toUpperCase()}: ${before.status} → ${order.status}`,
    metadata: { from: before.status, to: order.status },
    req,
  });
  await notifyOrderStatus(order); // WhatsApp the customer their new status
  return NextResponse.json({ order });
}
