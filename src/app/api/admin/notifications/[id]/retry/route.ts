import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { deliverNotification } from "@/lib/order-notify";

export const runtime = "nodejs";

/** POST /api/admin/notifications/[id]/retry — send a failed/skipped update again. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || (s.role !== "admin" && s.role !== "kitchen")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.orderNotification.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status === "SENT") {
    return NextResponse.json({ error: "This update was already sent." }, { status: 409 });
  }

  const notification = await deliverNotification(id);
  await audit({
    actor: actorFrom(s),
    action: "notification.retried",
    entityType: "order",
    entityId: existing.orderId,
    summary: `Retried WhatsApp "${existing.toStatus}" update for order #${existing.orderId.slice(-6).toUpperCase()} → ${notification?.status}`,
    metadata: { notificationId: id, result: notification?.status, error: notification?.error ?? null },
    req,
  });
  return NextResponse.json({ notification });
}
