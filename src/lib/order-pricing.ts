import "server-only";
import { prisma } from "./db";
import { effectivePrice } from "./pricing";
import type { Membership } from "./membership";

/**
 * The one way an order's money is worked out — the website checkout and the
 * WhatsApp assistant both use it (spec #9/#13), always from the live menu.
 */

export type CartLine = { menuItemId: string; name: string; mrp: number; price: number; qty: number };

/** Live prices for a cart, plus anything that can't be ordered right now. */
export async function priceCart(items: { id: string; qty: number }[]): Promise<{ lines: CartLine[]; problems: string[] }> {
  const menu = await prisma.menuItem.findMany({ where: { id: { in: [...new Set(items.map((i) => i.id))] } } });
  const byId = new Map(menu.map((m) => [m.id, m]));
  const lines: CartLine[] = [];
  const problems: string[] = [];
  for (const i of items) {
    const m = byId.get(i.id);
    if (!m || !m.available) {
      problems.push(`${m?.name ?? "A dish in your order"} is no longer on the menu.`);
      continue;
    }
    if (m.stock !== null && m.stock < i.qty) {
      problems.push(m.stock <= 0 ? `${m.name} is sold out.` : `Only ${m.stock} × ${m.name} left.`);
      continue;
    }
    lines.push({ menuItemId: m.id, name: m.name, mrp: m.price, price: effectivePrice(m.price, m.discountPercent), qty: i.qty });
  }
  return { lines, problems };
}

/** Subtotal, savings, member discount, delivery fee and total for priced lines. */
export function orderTotals(lines: CartLine[], opts: { membership: Pick<Membership, "active" | "discountPercent" | "freeDelivery">; deliveryFee: number | null; couponDiscount?: number }) {
  const subtotal = lines.reduce((n, i) => n + i.price * i.qty, 0);
  const discountTotal = lines.reduce((n, i) => n + (i.mrp - i.price) * i.qty, 0);
  const membershipDiscount = opts.membership.active ? Math.round((subtotal * opts.membership.discountPercent) / 100) : 0;
  const deliveryFee = subtotal > 0 && opts.deliveryFee !== null && !(opts.membership.active && opts.membership.freeDelivery) ? opts.deliveryFee : 0;
  const couponDiscount = opts.couponDiscount ?? 0;
  const total = Math.max(0, subtotal - membershipDiscount - couponDiscount) + deliveryFee;
  return { subtotal, discountTotal, membershipDiscount, deliveryFee, couponDiscount, total };
}
