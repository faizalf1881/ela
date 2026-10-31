import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { normalizePhone } from "@/lib/utils";
import { prepareTemplate } from "@/lib/wa-templates";
import { conversationFor, isTyping, sendChatTemplate } from "@/lib/wa-chat";

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

  return NextResponse.json({ conversations: conversations.map((c) => ({ ...c, typing: isTyping(c) })), counts: { ...counts, unread } });
}

const startSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  templateId: z.string().min(1),
  values: z.record(z.string(), z.string().max(1000)).default({}),
});

/**
 * POST — start (or restart) a conversation with an approved template (spec
 * #2). WhatsApp only lets a business message someone first with a template.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter the WhatsApp number and choose a template." }, { status: 400 });
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) return NextResponse.json({ error: "That doesn't look like a valid WhatsApp number." }, { status: 400 });

  const prepared = await prepareTemplate(parsed.data.templateId, parsed.data.values);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });
  const conv = await conversationFor(phone);
  const staff = actorFrom(s).label || "Admin";
  const message = await sendChatTemplate(conv, prepared, staff);
  await audit({
    actor: actorFrom(s),
    action: "whatsapp.template_sent",
    entityType: "conversation",
    entityId: conv.id,
    summary: `${staff} started a WhatsApp chat with +${phone} using template ${prepared.template.name}${message.status === "failed" ? " (failed)" : ""}`,
    metadata: { template: prepared.template.name, values: parsed.data.values, status: message.status },
    req,
  });
  if (message.status === "failed") return NextResponse.json({ error: message.error || "WhatsApp did not accept the template.", conversation: conv, message }, { status: 502 });
  return NextResponse.json({ conversation: conv, message }, { status: 201 });
}
