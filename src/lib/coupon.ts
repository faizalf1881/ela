import "server-only";
import { prisma } from "./db";

export type CouponResult =
  | { ok: true; code: string; discount: number; label: string }
  | { ok: false; error: string };

/**
 * Validate a coupon against an order subtotal and compute the discount (in whole
 * rupees). Pure read — does NOT increment usage; callers increment usedCount only
 * when the order is actually created. Codes are matched case-insensitively.
 */
export async function evaluateCoupon(rawCode: string, subtotal: number): Promise<CouponResult> {
  const code = (rawCode || "").trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a coupon code" };

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.active) return { ok: false, error: "Invalid or inactive coupon code" };

  const now = new Date();
  if (coupon.startsAt && coupon.startsAt > now) return { ok: false, error: "This coupon isn't active yet" };
  if (coupon.endsAt && coupon.endsAt < now) return { ok: false, error: "This coupon has expired" };
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return { ok: false, error: "This coupon has reached its usage limit" };
  }
  if (coupon.minOrder !== null && subtotal < coupon.minOrder) {
    return { ok: false, error: `Spend at least ₹${coupon.minOrder} to use this coupon` };
  }

  let discount = coupon.discountType === "PERCENT" ? Math.round((subtotal * coupon.value) / 100) : coupon.value;
  if (coupon.maxDiscount !== null) discount = Math.min(discount, coupon.maxDiscount);
  discount = Math.max(0, Math.min(discount, subtotal)); // never exceed the subtotal

  if (discount <= 0) return { ok: false, error: "This coupon gives no discount on your cart" };

  const label = coupon.discountType === "PERCENT" ? `${coupon.value}% off` : `₹${coupon.value} off`;
  return { ok: true, code: coupon.code, discount, label };
}
