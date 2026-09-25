import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { customerContext } from "@/lib/ai/assistant";
import { REPLY_WINDOW_MS } from "@/lib/wa-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/whatsapp/conversations/[id] — one conversation for staff:
 * the thread, its handling history, the automatic order updates sent to this
 * number, and the customer's CRM context (orders, membership, tickets — the
 * same facts the AI works from, plus internal notes).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const conversation = await prisma.waConversation.findUnique({
    where: { id },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [messages, events, updates, context] = await Promise.all([
    prisma.waMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.waHandlingEvent.findMany({ where: { conversationId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.orderNotification.findMany({
      where: { phone: conversation.phone, status: "SENT" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, orderId: true, toStatus: true, body: true, createdAt: true, deliveryStatus: true },
    }),
    customerContext(conversation),
  ]);

  const windowEndsAt = conversation.lastInboundAt ? new Date(conversation.lastInboundAt.getTime() + REPLY_WINDOW_MS) : null;
  return NextResponse.json({
    conversation,
    messages: messages.reverse(),
    events: events.reverse(),
    updates: updates.reverse(),
    context,
    replyWindow: { open: !!windowEndsAt && windowEndsAt.getTime() > Date.now(), endsAt: windowEndsAt },
  });
}
