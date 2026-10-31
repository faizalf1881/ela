import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { REPLY_WINDOW_MS, sendReadReceipt } from "@/lib/wa-chat";

export const runtime = "nodejs";

/**
 * POST — a staff member is typing a reply: the customer sees "typing…" (and
 * blue ticks), like on WhatsApp itself. Only while they are handling the chat
 * and the 24-hour window is open, since a reply must be able to follow.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const conv = await prisma.waConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (conv.mode !== "HUMAN" || !conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() > REPLY_WINDOW_MS) {
    return NextResponse.json({ ok: false, error: "No reply can be sent in this chat right now." }, { status: 409 });
  }
  const r = await sendReadReceipt(conv, true);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
