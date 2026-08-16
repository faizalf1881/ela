import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/menu-cache";

// GET /api/reviews — public: published. ?all=1 (admin): everything (incl. pending).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wantAll = searchParams.get("all") === "1";

  if (wantAll) {
    const s = await getSession();
    if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const reviews = await prisma.review.findMany({ orderBy: [{ published: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }] });
    return NextResponse.json({ reviews });
  }

  const reviews = await prisma.review.findMany({
    where: { published: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ reviews });
}

const createSchema = z.object({
  authorName: z.string().trim().min(1).max(80),
  location: z.string().max(80).nullable().optional(),
  rating: z.number().int().min(1).max(5).optional().default(5),
  body: z.string().trim().min(1).max(600),
  published: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
});

// POST /api/reviews — admin adds a review manually.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const review = await prisma.review.create({ data: { ...parsed.data, location: parsed.data.location ?? null, source: "manual" } });
  revalidateTag(CACHE_TAGS.reviews);
  await audit({ actor: actorFrom(s), action: "review.created", entityType: "review", entityId: review.id, summary: `Added review by ${review.authorName}`, req });
  return NextResponse.json({ review }, { status: 201 });
}
