import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/menu-cache";
import { effectivePrice } from "@/lib/pricing";
import { heroStats, publicSiteInfo, ratingBadge, resolveFeatured, SITE_DEFAULTS } from "@/lib/site-content";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin → Website (spec #6/#7): the homepage dish, offer banner, highlights,
 * rating badge and contact details. The response also carries what the site
 * will actually show (`preview`), worked out exactly as the homepage does.
 */
async function load() {
  const [row, menu, reviews] = await Promise.all([
    prisma.siteContent.findUnique({ where: { id: 1 } }),
    prisma.menuItem.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.review.findMany({ where: { published: true }, select: { rating: true } }),
  ]);
  const visible = menu.filter((m) => m.available);
  const info = publicSiteInfo(row);
  return {
    content: row,
    defaults: SITE_DEFAULTS,
    menu: menu.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      price: m.price,
      discountPercent: m.discountPercent,
      imageUrl: m.imageUrl,
      servingInfo: m.servingInfo,
      available: m.available,
      stock: m.stock,
      category: m.category,
    })),
    preview: {
      featured: resolveFeatured(visible, row, effectivePrice),
      // The chosen dish exists but customers can't see it right now.
      featuredHidden: !!row?.featuredItemId && !visible.some((m) => m.id === row.featuredItemId),
      stats: heroStats(row, { dishCount: visible.length, deliveryTime: info.deliveryTime }),
      rating: ratingBadge(row, reviews),
      autoRating: ratingBadge(row ? { ...row, ratingMode: "AUTO" } : null, reviews),
      info,
    },
  };
}

export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await load());
}

const opt = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null));
const link = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/[^\s<>"]+$/i.test(v), "Links must start with http:// or https://")
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v || null));

const schema = z.object({
  featuredItemId: z.string().trim().min(1).nullable().optional(),
  featuredLabel: z.string().trim().min(1).max(40).optional(),
  featuredNote: opt(200),
  promoActive: z.boolean().optional(),
  promoText: opt(160),
  promoCode: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Za-z0-9_-]*$/, "Offer codes use letters, digits, - and _")
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v.toUpperCase() : null)),
  heroStats: z
    .array(z.object({ value: z.string().trim().max(12), label: z.string().trim().max(40) }))
    .max(3)
    .optional(),
  ratingMode: z.enum(["AUTO", "CUSTOM", "HIDDEN"]).optional(),
  ratingValue: opt(12),
  ratingNote: opt(60),
  deliveryTime: opt(30),
  openingHours: opt(120),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d\s()-]*$/, "Phone numbers use digits, spaces, + and -")
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  email: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "Enter a valid email address")
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  address: opt(300),
  instagramUrl: link,
  facebookUrl: link,
  xUrl: link,
});

export async function PATCH(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first?.code === "custom" || first?.code === "invalid_string" ? first.message : "Please check the highlighted fields." }, { status: 400 });
  }
  const d = parsed.data;
  const data = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)) as typeof d;

  let dishName: string | null = null;
  if (data.featuredItemId) {
    const dish = await prisma.menuItem.findUnique({ where: { id: data.featuredItemId }, select: { name: true } });
    if (!dish) return NextResponse.json({ error: "Choose a dish from the menu." }, { status: 400 });
    dishName = dish.name;
  }
  if (data.promoActive && !(data.promoText ?? (await prisma.siteContent.findUnique({ where: { id: 1 } }))?.promoText)) {
    return NextResponse.json({ error: "Write the offer text before switching the banner on." }, { status: 400 });
  }

  await prisma.siteContent.upsert({
    where: { id: 1 },
    create: { id: 1, ...data, heroStats: data.heroStats ?? undefined },
    update: { ...data, heroStats: data.heroStats ?? undefined },
  });
  revalidateTag(CACHE_TAGS.content);

  const changes: string[] = [];
  if (d.featuredItemId !== undefined) changes.push(dishName ? `homepage dish set to "${dishName}"` : "homepage dish reset to automatic");
  if (d.featuredLabel) changes.push(`dish badge "${d.featuredLabel}"`);
  if (d.promoActive !== undefined) changes.push(`offer banner ${d.promoActive ? "ON" : "OFF"}`);
  const contact = ["phone", "email", "address", "openingHours", "deliveryTime", "instagramUrl", "facebookUrl", "xUrl"].filter((k) => k in data);
  if (contact.length) changes.push(`updated ${contact.join(", ")}`);
  await audit({
    actor: actorFrom(s),
    action: "site.updated",
    entityType: "siteContent",
    summary: `Website: ${changes.join("; ") || "content updated"}`,
    metadata: { ...data },
    req,
  });
  return NextResponse.json(await load());
}
