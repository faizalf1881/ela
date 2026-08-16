import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { razorpay } from "@/lib/razorpay";
import { razorpayPeriod } from "@/lib/membership";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(400).optional(),
  price: z.number().int().min(1).max(1_000_000).optional(),
  interval: z.enum(["WEEKLY", "MONTHLY", "YEARLY"]).optional(),
  intervalCount: z.number().int().min(1).max(12).optional(),
  discountPercent: z.number().int().min(0).max(90).optional(),
  freeDelivery: z.boolean().optional(),
  benefits: z.array(z.string().max(160)).max(12).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const before = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  const after = { ...before, ...parsed.data };
  let razorpayPlanId = before.razorpayPlanId;
  let warning: string | null = null;

  // Razorpay plans are immutable: price/interval changes (or a missing mirror)
  // need a fresh Razorpay plan. Existing subscribers keep billing on the old one.
  const needsNewRzpPlan =
    !razorpayPlanId ||
    after.price !== before.price ||
    after.interval !== before.interval ||
    after.intervalCount !== before.intervalCount;

  if (needsNewRzpPlan) {
    try {
      const rp = await razorpay().plans.create({
        period: razorpayPeriod(after.interval),
        interval: after.intervalCount,
        item: { name: after.name, amount: after.price * 100, currency: "INR", description: after.description || undefined },
      });
      razorpayPlanId = rp.id;
    } catch (e) {
      const msg = String((e as { error?: { description?: string } })?.error?.description || e);
      warning = `Saved, but the Razorpay plan could not be updated: ${msg}`;
      // eslint-disable-next-line no-console
      console.error("[Razorpay] plan update failed:", msg);
    }
  }

  const plan = await prisma.subscriptionPlan.update({ where: { id }, data: { ...parsed.data, razorpayPlanId } });
  await audit({
    actor: actorFrom(s),
    action: "plan.updated",
    entityType: "subscriptionPlan",
    entityId: id,
    summary: `Updated membership plan "${plan.name}"`,
    metadata: { changes: parsed.data, razorpayPlanId },
    req,
  });
  return NextResponse.json({ plan, warning });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Any subscription (even a cancelled one) is billing history worth keeping, and
  // deleting the plan would break that link — so hide the plan instead of deleting.
  const [live, total] = await Promise.all([
    prisma.subscription.count({ where: { planId: id, status: { in: ["ACTIVE", "CREATED", "PAUSED"] } } }),
    prisma.subscription.count({ where: { planId: id } }),
  ]);
  if (total > 0) {
    const updated = await prisma.subscriptionPlan.update({ where: { id }, data: { active: false } });
    await audit({
      actor: actorFrom(s),
      action: "plan.deactivated",
      entityType: "subscriptionPlan",
      entityId: id,
      summary: `Deactivated plan "${plan.name}" (${live} live / ${total} total subscriptions)`,
      req,
    });
    return NextResponse.json({
      plan: updated,
      deactivated: true,
      message:
        live > 0
          ? `${live} customer${live > 1 ? "s are" : " is"} on this plan, so it was hidden instead of deleted.`
          : "This plan has past subscriptions, so it was hidden instead of deleted (billing history is preserved).",
    });
  }

  await prisma.subscriptionPlan.delete({ where: { id } });
  await audit({ actor: actorFrom(s), action: "plan.deleted", entityType: "subscriptionPlan", entityId: id, summary: `Deleted plan "${plan.name}"`, req });
  return NextResponse.json({ ok: true });
}
