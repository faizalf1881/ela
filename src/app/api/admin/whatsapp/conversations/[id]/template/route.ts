import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { prepareTemplate } from "@/lib/wa-templates";
import { changeHandling, sendChatTemplate } from "@/lib/wa-chat";

export const runtime = "nodejs";

const schema = z.object({ templateId: z.string().min(1), values: z.record(z.string(), z.string().max(1000)).default({}) });

/**
 * POST — "Quick reply": send an approved template in this chat (spec #2).
 * Works whether or not the 24-hour window is open, and in AI mode too — a
 * template doesn't talk over anyone; the AI answers the customer's reply.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const conv = await prisma.waConversation.findUnique({ where: { id } });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a template." }, { status: 400 });

  const prepared = await prepareTemplate(parsed.data.templateId, parsed.data.values);
  if (!prepared.ok) return NextResponse.json({ error: prepared.error }, { status: 400 });
  const staff = actorFrom(s).label || "Admin";
  const message = await sendChatTemplate(conv, prepared, staff);
  await audit({
    actor: actorFrom(s),
    action: "whatsapp.template_sent",
    entityType: "conversation",
    entityId: id,
    summary: `${staff} sent template ${prepared.template.name} to +${conv.phone}${message.status === "failed" ? " (failed)" : ""}`,
    metadata: { template: prepared.template.name, values: parsed.data.values, status: message.status },
    req,
  });
  if (message.status === "failed") return NextResponse.json({ error: message.error || "WhatsApp did not accept the template.", message }, { status: 502 });
  if (conv.mode === "HUMAN" && (conv.state === "HUMAN_HANDLING" || conv.state === "REQUIRES_ATTENTION")) {
    await changeHandling(id, { state: "WAITING_CUSTOMER", reason: null }, { type: "staff", label: staff });
  }
  return NextResponse.json({ message });
}
