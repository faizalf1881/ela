import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { actorFrom } from "@/lib/audit";
import { z } from "zod";
import { changeHandling, REPLY_WINDOW_MS, sendChatMessage } from "@/lib/wa-chat";

export const runtime = "nodejs";

const schema = z.object({ body: z.string().trim().min(1).max(4000) });

/**
 * POST — staff reply to the customer through WhatsApp (spec #40). Only in
 * human mode, so staff and the AI never talk over each other.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const staff = { label: actorFrom(s).label || "Admin" };
  const { id } = await params;
  const conv = await prisma.waConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Type a message first." }, { status: 400 });
  if (conv.mode !== "HUMAN") return NextResponse.json({ error: "Take over the conversation before replying." }, { status: 409 });
  // WhatsApp only allows free-form replies within 24 hours of the customer's last message.
  if (!conv.lastInboundAt || Date.now() - conv.lastInboundAt.getTime() > REPLY_WINDOW_MS) {
    return NextResponse.json(
      { error: "The customer's last message was more than 24 hours ago, so WhatsApp won't deliver a normal reply. Ask them to message you, or call them." },
      { status: 409 },
    );
  }

  const message = await sendChatMessage(conv, parsed.data.body, "STAFF", staff.label);
  if (message.status === "failed") {
    return NextResponse.json({ error: message.error || "WhatsApp did not accept the message.", message }, { status: 502 });
  }
  // Staff answered: now it is the customer's turn.
  if (conv.state === "HUMAN_HANDLING" || conv.state === "REQUIRES_ATTENTION") {
    await changeHandling(id, { state: "WAITING_CUSTOMER", reason: null }, { type: "staff", label: staff.label });
  }
  await prisma.waConversation.update({ where: { id }, data: { unreadCount: 0 } });
  return NextResponse.json({ message });
}
