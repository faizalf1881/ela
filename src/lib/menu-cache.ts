import { unstable_cache } from "next/cache";
import { prisma } from "./db";

/** Cache tags — call revalidateTag(...) from mutations to bust these instantly. */
export const CACHE_TAGS = { menu: "menu", settings: "settings", locations: "locations", reviews: "reviews" } as const;

/**
 * Public (available) menu, cached in the Vercel Data Cache. Served from cache on
 * every homepage hit; busted the moment an admin edits the menu (revalidateTag).
 * The 300s revalidate is just a safety fallback.
 */
export const getPublicMenu = unstable_cache(
  async () =>
    prisma.menuItem.findMany({
      where: { available: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ["public-menu-v1"],
  { tags: [CACHE_TAGS.menu], revalidate: 300 },
);

/** Store open/closed setting, cached; busted when admin toggles it. */
export const getStoreSetting = unstable_cache(
  async () => prisma.storeSetting.findUnique({ where: { id: 1 } }),
  ["store-setting-v1"],
  { tags: [CACHE_TAGS.settings], revalidate: 300 },
);

/** Active delivery locations (admin-managed), cached; busted on any location change. */
export const getActiveLocations = unstable_cache(
  async () =>
    prisma.deliveryLocation.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ["active-locations-v1"],
  { tags: [CACHE_TAGS.locations], revalidate: 300 },
);

/** Published website testimonials, cached; busted when admin edits reviews. */
export const getPublishedReviews = unstable_cache(
  async () =>
    prisma.review.findMany({
      where: { published: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    }),
  ["published-reviews-v1"],
  { tags: [CACHE_TAGS.reviews], revalidate: 300 },
);
