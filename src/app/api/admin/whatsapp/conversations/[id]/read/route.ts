import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { sendReadReceipt } from "@/lib/wa-chat";

export const runtime = "nodejs";

/** POST — staff have seen the conversation. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const staff = { label: actorFrom(s).label || "Admin" };
  const { id } = await params;
  const conv = await prisma.waConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const conversation = await prisma.waConversation.update({ where: { id }, data: { unreadCount: 0 } });
  // The customer sees blue ticks once a person has actually opened the chat.
  if (conv.unreadCount > 0) await sendReadReceipt(conv).catch(() => null);
  return NextResponse.json({ conversation });
}
