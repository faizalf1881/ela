import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

/** POST — stop a campaign: whoever hasn't been sent it yet won't be. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const moved = await prisma.waCampaign.updateMany({ where: { id, status: "SENDING" }, data: { status: "CANCELLED", completedAt: new Date(), leaseUntil: null } });
  if (moved.count === 0) return NextResponse.json({ error: "Only a campaign that is sending can be stopped." }, { status: 409 });
  const skipped = await prisma.waCampaignRecipient.updateMany({ where: { campaignId: id, status: "PENDING" }, data: { status: "SKIPPED", error: "Campaign stopped before this was sent" } });
  await audit({ actor: actorFrom(s), action: "campaign.cancelled", entityType: "campaign", entityId: id, summary: `Campaign stopped — ${skipped.count} not sent`, req });
  return NextResponse.json({ ok: true, skipped: skipped.count });
}
