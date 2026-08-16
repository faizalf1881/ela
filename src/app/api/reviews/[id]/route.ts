import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/menu-cache";

const updateSchema = z.object({
  authorName: z.string().trim().min(1).max(80).optional(),
  location: z.string().max(80).nullable().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  body: z.string().trim().min(1).max(600).optional(),
  published: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const review = await prisma.review.update({ where: { id }, data: parsed.data }).catch(() => null);
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  revalidateTag(CACHE_TAGS.reviews);
  await audit({ actor: actorFrom(s), action: "review.updated", entityType: "review", entityId: id, summary: `Updated review by ${review.authorName}`, metadata: { changes: parsed.data }, req });
  return NextResponse.json({ review });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) return NextResponse.json({ error: "Review not found" }, { status: 404 });

  await prisma.review.delete({ where: { id } });
  revalidateTag(CACHE_TAGS.reviews);
  await audit({ actor: actorFrom(s), action: "review.deleted", entityType: "review", entityId: id, summary: `Deleted review by ${review.authorName}`, req });
  return NextResponse.json({ ok: true });
}
