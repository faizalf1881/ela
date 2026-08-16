import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

// GET /api/coupons — admin: all coupons (newest first).
export async function GET() {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const coupons = await prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ coupons });
}

const createSchema = z.object({
  code: z.string().trim().min(2).max(40),
  discountType: z.enum(["PERCENT", "FIXED"]).default("PERCENT"),
  value: z.number().int().min(1).max(1_000_000),
  minOrder: z.number().int().min(0).max(1_000_000).nullable().optional(),
  maxDiscount: z.number().int().min(0).max(1_000_000).nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  active: z.boolean().optional().default(true),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

// POST /api/coupons — admin only.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });

  const data = parsed.data;
  if (data.discountType === "PERCENT" && data.value > 100) {
    return NextResponse.json({ error: "Percent discount can't exceed 100" }, { status: 400 });
  }
  const code = data.code.toUpperCase();

  const existing = await prisma.coupon.findUnique({ where: { code } });
  if (existing) return NextResponse.json({ error: "A coupon with that code already exists" }, { status: 409 });

  const coupon = await prisma.coupon.create({
    data: {
      code,
      discountType: data.discountType,
      value: data.value,
      minOrder: data.minOrder ?? null,
      maxDiscount: data.maxDiscount ?? null,
      usageLimit: data.usageLimit ?? null,
      active: data.active,
      startsAt: data.startsAt ?? null,
      endsAt: data.endsAt ?? null,
    },
  });
  await audit({
    actor: actorFrom(s),
    action: "coupon.created",
    entityType: "coupon",
    entityId: coupon.id,
    summary: `Created coupon ${coupon.code}`,
    metadata: { code, discountType: data.discountType, value: data.value },
    req,
  });
  return NextResponse.json({ coupon }, { status: 201 });
}
