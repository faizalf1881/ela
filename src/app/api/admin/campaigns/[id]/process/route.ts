import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { continueCampaign } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST — send the next part of a campaign. Called by the previous part
 * (Authorization: Bearer CRON_SECRET) or by an admin; does nothing while
 * another part is sending.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const secret = process.env.CRON_SECRET;
  const bySystem = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!bySystem && (await getSession())?.role !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const c = await prisma.waCampaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ continuing: await continueCampaign(c) });
}
