import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

const updateSchema = z.object({
  discountType: z.enum(["PERCENT", "FIXED"]).optional(),
  value: z.number().int().min(1).max(1_000_000).optional(),
  minOrder: z.number().int().min(0).max(1_000_000).nullable().optional(),
  maxDiscount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  active: z.boolean().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const before = await prisma.coupon.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });
  if (parsed.data.discountType === "PERCENT" && (parsed.data.value ?? before.value) > 100) {
    return NextResponse.json({ error: "Percent discount can't exceed 100" }, { status: 400 });
  }

  const coupon = await prisma.coupon.update({ where: { id }, data: parsed.data });
  await audit({
    actor: actorFrom(s),
    action: "coupon.updated",
    entityType: "coupon",
    entityId: id,
    summary: `Updated coupon ${coupon.code}`,
    metadata: { changes: parsed.data },
    req,
  });
  return NextResponse.json({ coupon });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const coupon = await prisma.coupon.findUnique({ where: { id } });
  if (!coupon) return NextResponse.json({ error: "Coupon not found" }, { status: 404 });

  await prisma.coupon.delete({ where: { id } });
  await audit({
    actor: actorFrom(s),
    action: "coupon.deleted",
    entityType: "coupon",
    entityId: id,
    summary: `Deleted coupon ${coupon.code}`,
    req,
  });
  return NextResponse.json({ ok: true });
}
