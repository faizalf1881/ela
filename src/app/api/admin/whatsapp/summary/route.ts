import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/whatsapp/summary — counts for the nav badge. */
export async function GET() {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [attention, waitingOnStaff, unread] = await Promise.all([
    prisma.waConversation.count({ where: { state: "REQUIRES_ATTENTION" } }),
    prisma.waConversation.count({ where: { state: "HUMAN_HANDLING" } }),
    prisma.waConversation.count({ where: { unreadCount: { gt: 0 } } }),
  ]);
  return NextResponse.json({ attention, waitingOnStaff, unread });
}
