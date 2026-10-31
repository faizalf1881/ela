import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { addRecipients, type ImportRow } from "@/lib/campaigns";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.union([
  z.object({
    // Rows from an uploaded sheet (already read by /api/admin/campaigns/import).
    rows: z
      .array(z.object({ phone: z.union([z.string(), z.number()]).nullable(), name: z.string().max(200).nullable().optional(), data: z.record(z.string(), z.string().max(500)).optional(), row: z.number().int().optional() }))
      .max(5000),
  }),
  // Customers already in the CRM.
  z.object({ crm: z.enum(["all", "ordered", "recent", "members"]) }),
]);

/** POST — add people to a draft campaign; reports what was skipped and why (spec #4). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const c = await prisma.waCampaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status !== "DRAFT") return NextResponse.json({ error: "Recipients can't be changed once sending has started." }, { status: 409 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Nothing to add (up to 5,000 rows at a time)." }, { status: 400 });

  if ("rows" in parsed.data) {
    const report = await addRecipients(id, parsed.data.rows as ImportRow[], "file");
    return NextResponse.json({ report });
  }
  const since = new Date(Date.now() - 90 * 86_400_000);
  const customers = await prisma.customer.findMany({
    where:
      parsed.data.crm === "ordered"
        ? { orders: { some: { placedAt: { not: null } } } }
        : parsed.data.crm === "recent"
          ? { orders: { some: { placedAt: { gte: since } } } }
          : parsed.data.crm === "members"
            ? { subscriptions: { some: { status: "ACTIVE" } } }
            : {},
    select: { id: true, phone: true, name: true },
    take: 5000,
  });
  const report = await addRecipients(
    id,
    customers.map((cu) => ({ phone: cu.phone, name: cu.name, customerId: cu.id })),
    "crm",
  );
  return NextResponse.json({ report });
}

/** DELETE — ?id=<recipient> removes one person; ?all=1 empties the list. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const c = await prisma.waCampaign.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (c.status !== "DRAFT") return NextResponse.json({ error: "Recipients can't be changed once sending has started." }, { status: 409 });
  const u = new URL(req.url).searchParams;
  const one = u.get("id");
  const r = one
    ? await prisma.waCampaignRecipient.deleteMany({ where: { id: one, campaignId: id } })
    : u.get("all") === "1"
      ? await prisma.waCampaignRecipient.deleteMany({ where: { campaignId: id } })
      : { count: 0 };
  return NextResponse.json({ removed: r.count });
}
