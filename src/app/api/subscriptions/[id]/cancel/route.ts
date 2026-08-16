import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { razorpay } from "@/lib/razorpay";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

// POST /api/subscriptions/[id]/cancel — customer cancels their own membership
// (admin can cancel any). Cancels at the end of the paid cycle.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const sub = await prisma.subscription.findUnique({ where: { id }, include: { plan: true } });
  if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  const isAdmin = s.role === "admin";
  if (!isAdmin && sub.customerId !== s.sub) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (sub.status === "CANCELLED") return NextResponse.json({ subscription: sub });

  let warning: string | null = null;
  if (sub.razorpaySubscriptionId) {
    try {
      // cancel_at_cycle_end=1 → customer keeps benefits until the paid period ends.
      await razorpay().subscriptions.cancel(sub.razorpaySubscriptionId, true);
    } catch (e) {
      const msg = String((e as { error?: { description?: string } })?.error?.description || e);
      warning = `Marked cancelled locally, but Razorpay reported: ${msg}`;
      // eslint-disable-next-line no-console
      console.error("[Razorpay] subscription cancel failed:", msg);
    }
  }

  const updated = await prisma.subscription.update({
    where: { id },
    data: { status: "CANCELLED", cancelledAt: new Date() },
    include: { plan: true },
  });

  await audit({
    actor: actorFrom(s),
    action: "subscription.cancelled",
    entityType: "subscription",
    entityId: id,
    summary: `Membership "${sub.plan.name}" cancelled${isAdmin ? " by admin" : ""}`,
    metadata: { razorpaySubscriptionId: sub.razorpaySubscriptionId },
    req,
  });

  return NextResponse.json({ subscription: updated, warning });
}
