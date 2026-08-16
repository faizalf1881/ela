import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { razorpay } from "@/lib/razorpay";
import { audit, actorFrom } from "@/lib/audit";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

// Razorpay requires a finite cycle count; ~10 years of billing.
const TOTAL_COUNT: Record<string, number> = { WEEKLY: 520, MONTHLY: 120, YEARLY: 10 };

// GET /api/subscriptions — customer: own. admin: all (with filters).
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "";

  const where: Prisma.SubscriptionWhereInput = s.role === "customer" ? { customerId: s.sub } : {};
  if (s.role !== "customer" && status) where.status = status as Prisma.SubscriptionWhereInput["status"];

  const subscriptions = await prisma.subscription.findMany({
    where,
    include: {
      plan: true,
      charges: { orderBy: { paidAt: "desc" } },
      ...(s.role === "customer" ? {} : { customer: { select: { id: true, name: true, phone: true } } }),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  return NextResponse.json({ subscriptions });
}

const createSchema = z.object({ planId: z.string().trim().min(1) });

// POST /api/subscriptions — customer starts a membership (Razorpay eMandate/AutoPay).
export async function POST(req: Request) {
  const s = await getSession();
  if (!s || s.role !== "customer") return NextResponse.json({ error: "Please log in to subscribe." }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: parsed.data.planId, active: true } });
  if (!plan) return NextResponse.json({ error: "That plan is not available." }, { status: 404 });
  if (!plan.razorpayPlanId) {
    return NextResponse.json(
      { error: "This plan isn't ready for online billing yet. Please contact us." },
      { status: 503 },
    );
  }

  // One active membership at a time.
  const existing = await prisma.subscription.findFirst({ where: { customerId: s.sub, status: "ACTIVE" } });
  if (existing) return NextResponse.json({ error: "You already have an active membership." }, { status: 409 });

  const customer = await prisma.customer.findUnique({ where: { id: s.sub } });
  if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

  try {
    const rp = await razorpay().subscriptions.create({
      plan_id: plan.razorpayPlanId,
      total_count: TOTAL_COUNT[plan.interval] ?? 120,
      quantity: 1,
      customer_notify: 1,
      notes: { customerId: customer.id, phone: customer.phone, planId: plan.id },
    });

    const subscription = await prisma.subscription.create({
      data: {
        customerId: customer.id,
        planId: plan.id,
        status: "CREATED",
        razorpaySubscriptionId: rp.id,
      },
    });

    await audit({
      actor: actorFrom(s),
      action: "subscription.created",
      entityType: "subscription",
      entityId: subscription.id,
      summary: `Started checkout for "${plan.name}" membership`,
      metadata: { planId: plan.id, razorpaySubscriptionId: rp.id },
      req,
    });

    return NextResponse.json({
      subscription,
      razorpay: {
        subscriptionId: rp.id,
        keyId: process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        planName: plan.name,
        amount: plan.price * 100,
      },
    });
  } catch (e) {
    const msg = String((e as { error?: { description?: string } })?.error?.description || e);
    // eslint-disable-next-line no-console
    console.error("[Razorpay] subscription create failed:", msg);
    return NextResponse.json({ error: `Could not start the membership: ${msg}` }, { status: 502 });
  }
}
