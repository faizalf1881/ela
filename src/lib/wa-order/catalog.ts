import "server-only";
import { prisma } from "../db";
import { effectivePrice } from "../pricing";

/**
 * The live menu as the WhatsApp assistant sees it (spec #9): read straight
 * from the database on every message — never a copy — so a price change,
 * a hidden dish or a sold-out item applies to the very next reply.
 */

export type Dish = {
  id: string;
  name: string;
  description: string;
  category: string;
  /** What the customer pays (after the dish's own discount). */
  price: number;
  mrp: number;
  servingInfo: string | null;
  tag: string | null;
  stock: number | null;
  soldOut: boolean;
  imageUrl: string | null;
};

export async function liveMenu(): Promise<Dish[]> {
  const items = await prisma.menuItem.findMany({ where: { available: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  return items.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    price: effectivePrice(m.price, m.discountPercent),
    mrp: m.price,
    servingInfo: m.servingInfo,
    tag: m.tag,
    stock: m.stock,
    soldOut: m.stock !== null && m.stock <= 0,
    imageUrl: m.imageUrl,
  }));
}

/** Categories in menu order, with how many dishes can be ordered and the lowest price. */
export function categoriesOf(menu: Dish[]): { name: string; count: number; from: number }[] {
  const out: { name: string; count: number; from: number }[] = [];
  for (const d of menu) {
    if (d.soldOut) continue;
    const c = out.find((x) => x.name === d.category);
    if (c) {
      c.count++;
      c.from = Math.min(c.from, d.price);
    } else out.push({ name: d.category, count: 1, from: d.price });
  }
  return out;
}

/** The most-ordered dishes (by portions) over recent days, from real orders only. */
export async function popularDishes(days = 30, limit = 5): Promise<{ id: string; name: string; qty: number }[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.orderItem.groupBy({
    by: ["menuItemId"],
    where: { menuItemId: { not: null }, order: { placedAt: { gte: since }, status: { not: "CANCELLED" } } },
    _sum: { qty: true },
    orderBy: { _sum: { qty: "desc" } },
    take: limit * 2,
  });
  const ids = rows.map((r) => r.menuItemId!);
  const live = await prisma.menuItem.findMany({ where: { id: { in: ids }, available: true }, select: { id: true, name: true } });
  const names = new Map(live.map((m) => [m.id, m.name]));
  return rows
    .filter((r) => names.has(r.menuItemId!))
    .slice(0, limit)
    .map((r) => ({ id: r.menuItemId!, name: names.get(r.menuItemId!)!, qty: r._sum.qty ?? 0 }));
}
