import "server-only";
import { prisma } from "./db";
import { audit } from "./audit";

/** Thrown when a stocked dish ran out between adding to cart and confirming. */
export class OutOfStockError extends Error {
  constructor(public itemName: string) {
    super(`“${itemName}” just sold out.`);
    this.name = "OutOfStockError";
  }
}

/**
 * Marks an order as placed: assigns a sequential invoice number and reserves
 * stock. Idempotent — an order that already has an invoice number is returned
 * unchanged.
 *
 * Stock is decremented with the quantity in the WHERE clause, so Postgres
 * re-evaluates it under a row lock and two simultaneous orders for the last
 * portion cannot both succeed. Without that guard the check-then-decrement gap
 * let concurrent orders drive stock negative and oversell the kitchen.
 *
 * `strict` is used where nothing has been charged yet (Cash on Delivery): the
 * transaction aborts so the order is never placed. When money has already been
 * taken we cannot un-charge the customer, so stock is clamped at zero and the
 * shortfall is written to the audit log for the owner to act on.
 */
export async function finalizeOrder(orderId: string, opts: { strict?: boolean } = {}) {
  const oversold: string[] = [];

  const order = await prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!existing) throw new Error("Order not found");
    if (existing.invoiceNo) return existing; // already finalized

    for (const it of existing.items) {
      if (!it.menuItemId) continue;

      const res = await tx.menuItem.updateMany({
        where: { id: it.menuItemId, stock: { not: null, gte: it.qty } },
        data: { stock: { decrement: it.qty } },
      });
      if (res.count > 0) continue;

      // No row updated: either the dish has unlimited stock (fine), or there
      // genuinely isn't enough left.
      const item = await tx.menuItem.findUnique({
        where: { id: it.menuItemId },
        select: { name: true, stock: true },
      });
      if (!item || item.stock === null) continue; // unlimited — nothing to reserve

      if (opts.strict) throw new OutOfStockError(item.name);

      await tx.menuItem.update({ where: { id: it.menuItemId }, data: { stock: 0 } });
      oversold.push(item.name);
    }

    const counter = await tx.counter.upsert({
      where: { name: "invoice" },
      update: { value: { increment: 1 } },
      create: { name: "invoice", value: 1 },
    });
    const invoiceNo = "ELA-" + String(counter.value).padStart(5, "0");

    return tx.order.update({
      where: { id: orderId },
      data: { invoiceNo },
      include: { items: true },
    });
  });

  // Paid but short of stock — the owner needs to know immediately.
  if (oversold.length > 0) {
    await audit({
      actor: { type: "system", label: "fulfillment" },
      action: "order.oversold",
      entityType: "order",
      entityId: orderId,
      summary: `Paid order ${order.invoiceNo} exceeded available stock: ${oversold.join(", ")}`,
      metadata: { items: oversold },
    });
  }

  return order;
}
