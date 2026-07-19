import "server-only";
import { prisma } from "./db";

/**
 * Marks an order as placed: assigns a sequential invoice number and decrements
 * stock for any stocked menu items. Idempotent — if the order already has an
 * invoice number, it is returned unchanged (safe to call twice).
 */
export async function finalizeOrder(orderId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!existing) throw new Error("Order not found");
    if (existing.invoiceNo) return existing; // already finalized

    const counter = await tx.counter.upsert({
      where: { name: "invoice" },
      update: { value: { increment: 1 } },
      create: { name: "invoice", value: 1 },
    });
    const invoiceNo = "ELA-" + String(counter.value).padStart(5, "0");

    for (const it of existing.items) {
      if (it.menuItemId) {
        await tx.menuItem.updateMany({
          where: { id: it.menuItemId, stock: { not: null } },
          data: { stock: { decrement: it.qty } },
        });
      }
    }

    return tx.order.update({
      where: { id: orderId },
      data: { invoiceNo },
      include: { items: true },
    });
  });
}
