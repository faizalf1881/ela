import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { campaignStats, continueCampaign, mappingProblems } from "@/lib/campaigns";
import { whatsappConfigured } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST — confirm and send (spec #5). Refused until the message is complete,
 * there is someone to send to, and the admin has confirmed the recipients
 * agreed to hear from the business on WhatsApp. Also resumes a campaign that
 * stopped on an error (e.g. after renewing the access token).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const c = await prisma.waCampaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (c.status === "SENDING") {
    const resumed = await prisma.waCampaign.update({ where: { id }, data: { lastError: null } });
    await continueCampaign(resumed);
    return NextResponse.json({ campaign: resumed, resumed: true });
  }
  if (c.status !== "DRAFT") return NextResponse.json({ error: "This campaign has already been sent." }, { status: 409 });
  if (!whatsappConfigured()) return NextResponse.json({ error: "WhatsApp isn't connected on this server." }, { status: 503 });
  const problems = mappingProblems(c);
  if (problems.length) return NextResponse.json({ error: problems[0], problems }, { status: 400 });
  if (!c.optInConfirmed) {
    return NextResponse.json({ error: "Confirm that these people agreed to receive WhatsApp messages from Ela & Co. — WhatsApp requires it." }, { status: 400 });
  }
  const stats = await campaignStats(id);
  if (stats.pending === 0) return NextResponse.json({ error: "Add at least one recipient." }, { status: 400 });
  const tpl = await prisma.waTemplate.findUnique({ where: { id: c.templateId ?? "" } });
  if (!tpl || tpl.status !== "APPROVED") return NextResponse.json({ error: `The template "${c.templateName}" is no longer approved (${tpl?.status.toLowerCase() ?? "removed"}). Sync templates or choose another.` }, { status: 409 });

  const started = await prisma.waCampaign.updateMany({ where: { id, status: "DRAFT" }, data: { status: "SENDING", startedAt: new Date(), lastError: null } });
  if (started.count === 0) return NextResponse.json({ error: "This campaign is already being sent." }, { status: 409 });
  await audit({
    actor: actorFrom(s),
    action: "campaign.sent",
    entityType: "campaign",
    entityId: id,
    summary: `Campaign "${c.name}" started: template ${c.templateName} to ${stats.pending} people`,
    metadata: { template: c.templateName, category: c.templateCategory, recipients: stats.pending },
    req,
  });
  const campaign = await prisma.waCampaign.findUniqueOrThrow({ where: { id } });
  await continueCampaign(campaign);
  return NextResponse.json({ campaign, recipients: stats.pending });
}
