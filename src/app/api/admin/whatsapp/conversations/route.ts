import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS: Record<string, Prisma.WaConversationWhereInput> = {
  attention: { state: "REQUIRES_ATTENTION" },
  human: { state: "HUMAN_HANDLING" },
  waiting: { state: "WAITING_CUSTOMER" },
  ai: { state: "AI_HANDLING" },
  unread: { unreadCount: { gt: 0 } },
};

/**
 * GET /api/admin/whatsapp/conversations — the WhatsApp inbox (spec #39).
 * ?filter=attention|human|waiting|ai|unread  ?q= name / phone / message text
 */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter") || "";
  const q = searchParams.get("q")?.trim() || "";

  const where: Prisma.WaConversationWhereInput = { ...(FILTERS[filter] ?? {}) };
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [
      { profileName: { contains: q, mode: "insensitive" } },
      { customer: { name: { contains: q, mode: "insensitive" } } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      { messages: { some: { body: { contains: q, mode: "insensitive" } } } },
    ];
  }

  const [conversations, grouped, unread] = await Promise.all([
    prisma.waConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: 100,
      include: { customer: { select: { id: true, name: true } } },
    }),
    prisma.waConversation.groupBy({ by: ["state"], _count: { _all: true } }),
    prisma.waConversation.count({ where: { unreadCount: { gt: 0 } } }),
  ]);
  const counts = Object.fromEntries(grouped.map((g) => [g.state, g._count._all]));

  return NextResponse.json({ conversations, counts: { ...counts, unread } });
}
