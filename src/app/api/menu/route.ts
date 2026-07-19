import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/menu-cache";

// GET /api/menu  — public: available items only.  ?all=1 (admin): everything.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wantAll = searchParams.get("all") === "1";

  let includeHidden = false;
  if (wantAll) {
    const s = await getSession();
    includeHidden = s?.role === "admin";
  }

  const items = await prisma.menuItem.findMany({
    where: includeHidden ? {} : { available: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ items });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().default(""),
  price: z.number().int().min(1).max(1_000_000),
  discountPercent: z.number().int().min(0).max(90).optional().default(0),
  category: z.string().max(60).optional().default("Meals"),
  tag: z.string().max(40).nullable().optional(),
  spice: z.number().int().min(0).max(3).optional().default(1),
  imageUrl: z.string().max(600).nullable().optional(),
  available: z.boolean().optional().default(true),
  stock: z.number().int().min(0).max(100000).nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
});

// POST /api/menu  — admin only.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
  }

  const item = await prisma.menuItem.create({ data: parsed.data });
  revalidateTag(CACHE_TAGS.menu);
  await audit({ actor: actorFrom(s), action: "menu.created", entityType: "menuItem", entityId: item.id, summary: `Added menu item "${item.name}" (₹${item.price})`, metadata: { ...parsed.data }, req });
  return NextResponse.json({ item }, { status: 201 });
}
