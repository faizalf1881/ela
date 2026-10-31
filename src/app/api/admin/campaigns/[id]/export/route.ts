import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

const csv = (v: unknown) => {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** A name from an uploaded sheet must never run as a formula when the CSV is opened in Excel. */
const plainText = (v: string | null) => (v && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** GET — every recipient of a campaign with their delivery status, as CSV. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const c = await prisma.waCampaign.findUnique({ where: { id } });
  if (!c) return new Response("Not found", { status: 404 });
  const rows = await prisma.waCampaignRecipient.findMany({ where: { campaignId: id }, orderBy: { createdAt: "asc" } });
  const lines = [
    ["Name", "Phone", "Status", "Sent at", "Delivered at", "Read at", "Reason"].join(","),
    ...rows.map((r) => [plainText(r.name), `+${r.phone}`, r.status, r.sentAt, r.deliveredAt, r.readAt, r.error].map(csv).join(",")),
  ];
  const name = c.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "campaign";
  return new Response(`﻿${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-recipients.csv"` },
  });
}
