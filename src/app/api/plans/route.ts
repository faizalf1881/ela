import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { razorpay } from "@/lib/razorpay";
import { razorpayPeriod } from "@/lib/membership";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/plans — public: active plans. ?all=1 (admin): everything.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("all") === "1") {
    const s = await getSession();
    if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const plans = await prisma.subscriptionPlan.findMany({ orderBy: [{ sortOrder: "asc" }, { price: "asc" }] });
    return NextResponse.json({ plans });
  }

  const plans = await prisma.subscriptionPlan.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });
  return NextResponse.json({ plans });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(400).optional().default(""),
  price: z.number().int().min(1).max(1_000_000),
  interval: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]).default("MONTHLY"),
  intervalCount: z.number().int().min(1).max(12).optional().default(1),
  discountPercent: z.number().int().min(0).max(90).optional().default(0),
  freeDelivery: z.boolean().optional().default(true),
  benefits: z.array(z.string().max(160)).max(12).optional().default([]),
  active: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
});

// POST /api/plans — admin creates a plan (also mirrored into Razorpay for AutoPay).
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
  const d = parsed.data;

  // Mirror into Razorpay so subscriptions (eMandate/AutoPay) can bill against it.
  // If the account doesn't have Subscriptions enabled we still save the plan
  // locally and tell the admin — the plan just can't be subscribed to yet.
  let razorpayPlanId: string | null = null;
  let warning: string | null = null;
  try {
    const rp = await razorpay().plans.create({
      period: razorpayPeriod(d.interval),
      interval: d.intervalCount,
      item: { name: d.name, amount: d.price * 100, currency: "INR", description: d.description || undefined },
    });
    razorpayPlanId = rp.id;
  } catch (e) {
    const msg = String((e as { error?: { description?: string } })?.error?.description || e);
    warning = `Saved locally, but Razorpay plan creation failed: ${msg}. Enable Subscriptions on your Razorpay account, then re-save this plan.`;
    // eslint-disable-next-line no-console
    console.error("[Razorpay] plan create failed:", msg);
  }

  const plan = await prisma.subscriptionPlan.create({ data: { ...d, razorpayPlanId } });
  await audit({
    actor: actorFrom(s),
    action: "plan.created",
    entityType: "subscriptionPlan",
    entityId: plan.id,
    summary: `Created membership plan "${plan.name}" (₹${plan.price}/${d.interval.toLowerCase()})`,
    metadata: { ...d, razorpayPlanId },
    req,
  });

  return NextResponse.json({ plan, warning }, { status: 201 });
}
