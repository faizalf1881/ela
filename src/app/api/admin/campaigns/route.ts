import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { campaignStats } from "@/lib/campaigns";
import { unsupportedReason } from "@/lib/wa-template-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — every campaign, newest first, with its delivery numbers (spec #5). */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const rows = await prisma.waCampaign.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  const campaigns = await Promise.all(
    rows.map(async (c) => ({
      id: c.id,
      name: c.name,
      templateName: c.templateName,
      templateCategory: c.templateCategory,
      status: c.status,
      lastError: c.lastError,
      createdAt: c.createdAt,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      stats: await campaignStats(c.id),
    })),
  );
  return NextResponse.json({ campaigns });
}

const schema = z.object({ name: z.string().trim().min(1, "Give the campaign a name").max(80), templateId: z.string().min(1, "Choose a template") });

/** POST — a new draft campaign for an approved template. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid campaign" }, { status: 400 });
  const t = await prisma.waTemplate.findUnique({ where: { id: parsed.data.templateId } });
  if (!t || t.status !== "APPROVED") return NextResponse.json({ error: "Choose a template WhatsApp has approved." }, { status: 400 });
  const reason = unsupportedReason(t);
  if (reason) return NextResponse.json({ error: reason }, { status: 400 });
  const c = await prisma.waCampaign.create({
    data: {
      name: parsed.data.name,
      templateId: t.id,
      templateName: t.name,
      templateLanguage: t.language,
      templateCategory: t.category,
      templateFormat: t.parameterFormat,
      components: t.components as Prisma.InputJsonValue,
      createdBy: actorFrom(s).label ?? null,
    },
  });
  await audit({ actor: actorFrom(s), action: "campaign.created", entityType: "campaign", entityId: c.id, summary: `Campaign "${c.name}" created with template ${t.name}`, req });
  return NextResponse.json({ campaign: c }, { status: 201 });
}
