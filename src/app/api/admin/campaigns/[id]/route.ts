import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { campaignStats, campaignTemplate, continueCampaign, mappingProblems, recipientValues } from "@/lib/campaigns";
import { previewText, renderPreview, templateVariables, unsupportedReason } from "@/lib/wa-template-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Opening a sending campaign continues it after the response (a ~40 s batch).
export const maxDuration = 60;

async function admin() {
  const s = await getSession();
  if (!s) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (s.role !== "admin") return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { s };
}

/**
 * GET — one campaign: its settings, the message preview for the first
 * recipient, delivery numbers and a page of recipients (?status= ?q= ?page=).
 * While it is sending, opening it also keeps the sending going.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await admin();
  if (a.error) return a.error;
  const { id } = await params;
  const c = await prisma.waCampaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const u = new URL(req.url).searchParams;
  const status = u.get("status") || "";
  const q = (u.get("q") || "").trim();
  const page = Math.max(0, Number(u.get("page")) || 0);
  const where: Prisma.WaCampaignRecipientWhereInput = {
    campaignId: id,
    ...(status === "SENT" ? { status: { in: ["SENT", "DELIVERED", "READ"] } } : status === "DELIVERED" ? { status: { in: ["DELIVERED", "READ"] } } : status ? { status: status as never } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } : {}),
  };
  const [stats, total, recipients, first, sampleRows] = await Promise.all([
    campaignStats(id),
    prisma.waCampaignRecipient.count({ where }),
    prisma.waCampaignRecipient.findMany({ where, orderBy: { createdAt: "asc" }, skip: page * 50, take: 50 }),
    prisma.waCampaignRecipient.findFirst({ where: { campaignId: id }, orderBy: { createdAt: "asc" } }),
    prisma.waCampaignRecipient.findMany({ where: { campaignId: id, data: { not: undefined } }, select: { data: true }, take: 200 }),
  ]);
  const columns = [...new Set(sampleRows.flatMap((r) => Object.keys((r.data ?? {}) as Record<string, unknown>)))];
  const tpl = campaignTemplate(c);
  const sample = first ?? { phone: "919876543210", name: "Anjali Menon", data: null };
  const preview = renderPreview(tpl, recipientValues(c, sample));
  if (c.status === "SENDING") await continueCampaign(c);

  return NextResponse.json({
    campaign: c,
    stats,
    variables: templateVariables(tpl),
    problems: mappingProblems(c),
    unsupported: unsupportedReason(tpl),
    preview,
    previewFor: first ? { name: first.name, phone: first.phone } : null,
    previewText: previewText(preview),
    columns,
    recipients: { items: recipients, total, page },
  });
}

const paramSchema = z.object({
  source: z.enum(["name", "first_name", "phone", "column", "text"]),
  value: z.string().max(1000).optional(),
  fallback: z.string().max(200).optional(),
});
const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  params: z.record(z.string().max(40), paramSchema).optional(),
  optInConfirmed: z.boolean().optional(),
});

/** PATCH — name, variable mapping and the opt-in confirmation (drafts only). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await admin();
  if (a.error) return a.error;
  const { id } = await params;
  const c = await prisma.waCampaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status !== "DRAFT") return NextResponse.json({ error: "A campaign can't be changed once it has started sending." }, { status: 409 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the campaign details" }, { status: 400 });
  const updated = await prisma.waCampaign.update({
    where: { id },
    data: {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.params ? { params: parsed.data.params as Prisma.InputJsonValue } : {}),
      ...(parsed.data.optInConfirmed !== undefined ? { optInConfirmed: parsed.data.optInConfirmed } : {}),
    },
  });
  if (parsed.data.optInConfirmed !== undefined) {
    await audit({
      actor: actorFrom(a.s),
      action: "campaign.opt_in_confirmed",
      entityType: "campaign",
      entityId: id,
      summary: `${parsed.data.optInConfirmed ? "Confirmed" : "Withdrew confirmation"} that the recipients of "${c.name}" agreed to WhatsApp messages`,
      req,
    });
  }
  return NextResponse.json({ campaign: updated, problems: mappingProblems(updated) });
}

/** DELETE — a draft that was never sent. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await admin();
  if (a.error) return a.error;
  const { id } = await params;
  const c = await prisma.waCampaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status !== "DRAFT") return NextResponse.json({ error: "Sent campaigns are kept as a record." }, { status: 409 });
  await prisma.waCampaign.delete({ where: { id } });
  await audit({ actor: actorFrom(a.s), action: "campaign.deleted", entityType: "campaign", entityId: id, summary: `Draft campaign "${c.name}" deleted`, req });
  return NextResponse.json({ ok: true });
}
