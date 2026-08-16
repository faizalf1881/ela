import "server-only";
import { prisma } from "./db";

export type Membership = {
  active: boolean;
  planName: string | null;
  discountPercent: number;
  freeDelivery: boolean;
  renewsAt: Date | null;
  subscriptionId: string | null;
};

export const NO_MEMBERSHIP: Membership = {
  active: false,
  planName: null,
  discountPercent: 0,
  freeDelivery: false,
  renewsAt: null,
  subscriptionId: null,
};

/**
 * The customer's current membership benefits. A subscription counts as active
 * while its status is ACTIVE and it hasn't lapsed past `currentEnd`.
 */
export async function getMembership(customerId: string | undefined | null): Promise<Membership> {
  if (!customerId) return NO_MEMBERSHIP;

  const sub = await prisma.subscription.findFirst({
    where: { customerId, status: "ACTIVE" },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) return NO_MEMBERSHIP;

  // Lapsed (Razorpay webhook missed / payment failed) — treat as inactive.
  if (sub.currentEnd && sub.currentEnd.getTime() < Date.now()) return NO_MEMBERSHIP;

  return {
    active: true,
    planName: sub.plan.name,
    discountPercent: sub.plan.discountPercent,
    freeDelivery: sub.plan.freeDelivery,
    renewsAt: sub.currentEnd,
    subscriptionId: sub.id,
  };
}

/** Razorpay billing period mapping for a plan interval. */
export function razorpayPeriod(interval: "WEEKLY" | "MONTHLY" | "YEARLY"): "weekly" | "monthly" | "yearly" {
  return interval === "WEEKLY" ? "weekly" : interval === "YEARLY" ? "yearly" : "monthly";
}

/** Add one billing cycle to `from` — used as a fallback renewal date. */
export function addCycle(from: Date, interval: "WEEKLY" | "MONTHLY" | "YEARLY", count = 1): Date {
  const d = new Date(from);
  if (interval === "WEEKLY") d.setDate(d.getDate() + 7 * count);
  else if (interval === "YEARLY") d.setFullYear(d.getFullYear() + count);
  else d.setMonth(d.getMonth() + count);
  return d;
}
