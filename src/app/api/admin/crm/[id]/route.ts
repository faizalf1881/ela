import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

const schema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
});

// PATCH /api/admin/crm/[id] — admin updates CRM notes / address.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const customer = await prisma.customer.update({ where: { id }, data: parsed.data }).catch(() => null);
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  await audit({
    actor: actorFrom(s),
    action: "customer.updated",
    entityType: "customer",
    entityId: id,
    summary: `Updated CRM record for ${customer.name || customer.phone}`,
    req,
  });
  return NextResponse.json({ customer });
}
