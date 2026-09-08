import "server-only";
import { prisma } from "./db";
import { addDays, dateKeyFromDb, istDateKey, toDbDate, weekdayOf } from "./delivery";
import { finalizeOrder } from "./fulfillment";
import { audit } from "./audit";

export type GenerationResult = {
  date: string;
  created: { subscriptionId: string; orderId: string; customer: string }[];
  skipped: { subscriptionId: string; reason: string }[];
};

/**
 * Creates the daily order for every active meal-plan subscriber for one service
 * date. Safe to run repeatedly: a unique index on (subscriptionId, deliveryDate)
 * plus an explicit pre-check means a second run creates nothing.
 *
 * Meals are prepaid through the subscription, so the generated order carries the
 * dish value for the kitchen but a zero balance — the money is recognised on the
 * subscription charge, not again here.
 */
export async function generateMealPlanOrders(dateKey?: string): Promise<GenerationResult> {
  const date = dateKey || istDateKey();
  const weekday = weekdayOf(date);
  const result: GenerationResult = { date, created: [], skipped: [] };

  const subs = await prisma.subscription.findMany({
    where: { status: "ACTIVE", plan: { kind: "MEAL" } },
    include: {
      plan: { include: { mealItems: { include: { menuItem: true } } } },
      customer: true,
      deliveryLocation: true,
    },
  });

  for (const sub of subs) {
    const label = sub.customer.name || sub.customer.phone;

    // Respect the service window.
    if (sub.startDate && dateKeyFromDb(sub.startDate) > date) {
      result.skipped.push({ subscriptionId: sub.id, reason: "not started yet" });
      continue;
    }
    if (sub.endDate && dateKeyFromDb(sub.endDate) < date) {
      result.skipped.push({ subscriptionId: sub.id, reason: "service window ended" });
      continue;
    }
    // A lapsed renewal means the plan is no longer paid for.
    if (sub.currentEnd && sub.currentEnd.getTime() < new Date(`${date}T00:00:00Z`).getTime()) {
      result.skipped.push({ subscriptionId: sub.id, reason: "subscription lapsed" });
      continue;
    }
    if (!sub.plan.serviceDays.includes(weekday)) {
      result.skipped.push({ subscriptionId: sub.id, reason: "not a service day" });
      continue;
    }
    if (sub.plan.mealItems.length === 0) {
      result.skipped.push({ subscriptionId: sub.id, reason: "plan has no meal items" });
      continue;
    }
    if (!sub.deliveryLocationId) {
      result.skipped.push({ subscriptionId: sub.id, reason: "no delivery location set" });
      continue;
    }

    // Idempotency: never a second order for the same subscription + date.
    const existing = await prisma.order.findFirst({
      where: { subscriptionId: sub.id, deliveryDate: toDbDate(date) },
      select: { id: true },
    });
    if (existing) {
      result.skipped.push({ subscriptionId: sub.id, reason: "already generated" });
      continue;
    }

    const lineItems = sub.plan.mealItems.map((mi) => ({
      menuItemId: mi.menuItemId,
      name: mi.menuItem.name,
      mrp: mi.menuItem.price,
      price: mi.menuItem.price,
      qty: mi.qty,
    }));
    const value = lineItems.reduce((n, i) => n + i.price * i.qty, 0);

    try {
      const created = await prisma.order.create({
        data: {
          customerId: sub.customerId,
          customerName: sub.customer.name || "Subscriber",
          customerPhone: sub.customer.phone,
          address: sub.deliveryLocation?.area
            ? `${sub.deliveryLocation.name}, ${sub.deliveryLocation.area}`
            : (sub.deliveryLocation?.name ?? "Subscription delivery"),
          deliveryLocationId: sub.deliveryLocationId,
          deliveryDate: toDbDate(date),
          deliverySlotId: sub.deliverySlotId,
          subscriptionId: sub.id,
          source: "subscription",
          subtotal: value,
          // Prepaid through the plan, so nothing is collected on delivery.
          discountTotal: value,
          deliveryFee: 0,
          total: 0,
          paymentMethod: "subscription",
          paymentStatus: "PAID",
          status: "PLACED",
          items: { create: lineItems },
        },
      });

      // Invoice number + stock decrement, same as any confirmed order.
      await finalizeOrder(created.id);
      result.created.push({ subscriptionId: sub.id, orderId: created.id, customer: label });
    } catch (e) {
      // Unique-constraint race (two runs at once) is a skip, not a failure.
      result.skipped.push({ subscriptionId: sub.id, reason: `not created: ${(e as Error).message.split("\n")[0]}` });
    }
  }

  await audit({
    actor: { type: "system", label: "meal-plan-scheduler" },
    action: "subscription.orders_generated",
    entityType: "subscription",
    summary: `Meal plans for ${date}: ${result.created.length} order(s) created, ${result.skipped.length} skipped`,
    metadata: { date, created: result.created.length, skipped: result.skipped },
  });

  return result;
}

/** The next date on or after `from` that the plan actually serves. */
export function nextServiceDate(serviceDays: number[], from = istDateKey()): string | null {
  for (let i = 0; i < 14; i++) {
    const key = addDays(from, i);
    if (serviceDays.includes(weekdayOf(key))) return key;
  }
  return null;
}
