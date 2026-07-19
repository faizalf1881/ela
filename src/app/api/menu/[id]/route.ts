import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/menu-cache";

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  price: z.number().int().min(1).max(1_000_000).optional(),
  discountPercent: z.number().int().min(0).max(90).optional(),
  category: z.string().max(60).optional(),
  tag: z.string().max(40).nullable().optional(),
  spice: z.number().int().min(0).max(3).optional(),
  imageUrl: z.string().max(600).nullable().optional(),
  available: z.boolean().optional(),
  stock: z.number().int().min(0).max(100000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const before = await prisma.menuItem.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  const item = await prisma.menuItem.update({ where: { id }, data: parsed.data });
  revalidateTag(CACHE_TAGS.menu);

  const b = before as unknown as Record<string, unknown>;
  const a = item as unknown as Record<string, unknown>;
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(parsed.data)) {
    if (b[k] !== a[k]) changes[k] = { from: b[k], to: a[k] };
  }
  await audit({
    actor: actorFrom(s),
    action: "menu.updated",
    entityType: "menuItem",
    entityId: id,
    summary: `Updated menu item "${item.name}"`,
    metadata: { changes },
    req,
  });

  return NextResponse.json({ item });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const item = await prisma.menuItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  await prisma.menuItem.delete({ where: { id } });
  revalidateTag(CACHE_TAGS.menu);
  await audit({
    actor: actorFrom(s),
    action: "menu.deleted",
    entityType: "menuItem",
    entityId: id,
    summary: `Deleted menu item "${item.name}"`,
    metadata: { name: item.name, price: item.price },
    req,
  });

  return NextResponse.json({ ok: true });
}
