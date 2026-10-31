import { normalizePhone } from "./utils";

/**
 * Website content the owner edits in Admin → Website (spec #6/#7). Pure and
 * client-safe: the homepage resolves it on the server, client pages (checkout,
 * orders…) fetch the same shape from /api/site.
 */

/** Ready-made badges for the homepage dish; any custom wording is also allowed. */
export const FEATURED_LABELS = ["Today's Special", "Most Popular", "Featured Dish", "Best Seller", "Recommended", "Chef's Special"] as const;

/** What the site shows for a field the owner has left blank. */
export const SITE_DEFAULTS = {
  featuredLabel: "Today's Special",
  deliveryTime: "45 min",
  phone: "+91 79075 77979",
  email: "admin.ela.co@gmail.com",
  address: "TC 11/1074, PKRA 130, Pattom P.O., Thiruvananthapuram, Kerala — 695004",
  statLabels: ["Dishes on the menu", "Homemade", "Avg delivery"],
  statValues: ["", "100%", ""],
} as const;

export type RatingMode = "AUTO" | "CUSTOM" | "HIDDEN";
export type HeroStat = { value: string; label: string };

/** The stored row (or null before the owner has saved anything). */
export type SiteContentRow = {
  featuredItemId: string | null;
  featuredLabel: string;
  featuredNote: string | null;
  promoActive: boolean;
  promoText: string | null;
  promoCode: string | null;
  heroStats: unknown;
  ratingMode: string;
  ratingValue: string | null;
  ratingNote: string | null;
  deliveryTime: string | null;
  openingHours: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
};

const text = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/** Contact + delivery facts shown in the footer and other client pages. */
export type PublicSiteInfo = {
  deliveryTime: string;
  openingHours: string | null;
  phone: string;
  /** Digits for tel: links, with country code. */
  phoneDial: string | null;
  email: string;
  address: string;
  socials: { instagram: string | null; facebook: string | null; x: string | null };
  promo: { text: string; code: string | null } | null;
};

export function publicSiteInfo(row: SiteContentRow | null | undefined): PublicSiteInfo {
  const phone = text(row?.phone) ?? SITE_DEFAULTS.phone;
  const promoText = row?.promoActive ? text(row.promoText) : null;
  return {
    deliveryTime: text(row?.deliveryTime) ?? SITE_DEFAULTS.deliveryTime,
    openingHours: text(row?.openingHours),
    phone,
    phoneDial: normalizePhone(phone),
    email: text(row?.email) ?? SITE_DEFAULTS.email,
    address: text(row?.address) ?? SITE_DEFAULTS.address,
    socials: { instagram: text(row?.instagramUrl), facebook: text(row?.facebookUrl), x: text(row?.xUrl) },
    promo: promoText ? { text: promoText, code: text(row?.promoCode)?.toUpperCase() ?? null } : null,
  };
}

/**
 * The three hero highlights. A blank value is filled automatically: the number
 * of dishes on today's menu, and the delivery time.
 */
export function heroStats(row: SiteContentRow | null | undefined, ctx: { dishCount: number; deliveryTime: string }): HeroStat[] {
  const saved = Array.isArray(row?.heroStats) ? (row!.heroStats as Partial<HeroStat>[]) : [];
  const auto = [ctx.dishCount > 0 ? String(ctx.dishCount) : "", SITE_DEFAULTS.statValues[1], ctx.deliveryTime];
  return [0, 1, 2]
    .map((i) => ({
      value: text(saved[i]?.value) ?? auto[i],
      label: text(saved[i]?.label) ?? SITE_DEFAULTS.statLabels[i],
    }))
    .filter((s) => s.value);
}

/** The rating badge: worked out from published reviews, the owner's own figure, or hidden. */
export function ratingBadge(
  row: SiteContentRow | null | undefined,
  reviews: { rating: number }[],
): { value: string; note: string } | null {
  const mode = (row?.ratingMode as RatingMode) || "AUTO";
  if (mode === "HIDDEN") return null;
  if (mode === "CUSTOM") {
    const value = text(row?.ratingValue);
    return value ? { value, note: text(row?.ratingNote) ?? "" } : null;
  }
  if (reviews.length === 0) return null;
  const avg = reviews.reduce((n, r) => n + r.rating, 0) / reviews.length;
  return { value: `${avg.toFixed(1)} ★`, note: `${reviews.length.toLocaleString("en-IN")} review${reviews.length === 1 ? "" : "s"}` };
}

type MenuLike = {
  id: string;
  name: string;
  description: string;
  price: number;
  discountPercent: number;
  imageUrl: string | null;
  servingInfo: string | null;
  stock: number | null;
};

export type FeaturedDish = {
  id: string;
  name: string;
  description: string;
  /** What the customer pays (after the dish's own discount). */
  price: number;
  mrp: number;
  imageUrl: string | null;
  servingInfo: string | null;
  label: string;
  soldOut: boolean;
  stock: number | null;
};

/**
 * The homepage dish (spec #6). `menu` is the live public menu, so a dish the
 * owner hid is never advertised: the card falls back to the first dish still
 * in stock until another is chosen. Price and photo always come from the menu
 * itself, so a price change shows here the moment it is saved.
 */
export function resolveFeatured(menu: MenuLike[], row: SiteContentRow | null | undefined, effective: (price: number, pct: number) => number): FeaturedDish | null {
  const chosen = row?.featuredItemId ? menu.find((m) => m.id === row.featuredItemId) : undefined;
  const item = chosen ?? menu.find((m) => m.stock === null || m.stock > 0) ?? menu[0];
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    description: (chosen && text(row?.featuredNote)) || item.description,
    price: effective(item.price, item.discountPercent),
    mrp: item.price,
    imageUrl: item.imageUrl,
    servingInfo: text(item.servingInfo),
    label: chosen ? (text(row?.featuredLabel) ?? SITE_DEFAULTS.featuredLabel) : "Featured Dish",
    soldOut: item.stock !== null && item.stock <= 0,
    stock: item.stock,
  };
}
