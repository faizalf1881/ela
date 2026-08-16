import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/menu-cache";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  area: z.string().max(120).nullable().optional(),
  deliveryFee: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const before = await prisma.deliveryLocation.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  const location = await prisma.deliveryLocation.update({ where: { id }, data: parsed.data });
  revalidateTag(CACHE_TAGS.locations);
  await audit({
    actor: actorFrom(s),
    action: "location.updated",
    entityType: "deliveryLocation",
    entityId: id,
    summary: `Updated delivery location "${location.name}"`,
    metadata: { changes: parsed.data },
    req,
  });
  return NextResponse.json({ location });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const location = await prisma.deliveryLocation.findUnique({ where: { id } });
  if (!location) return NextResponse.json({ error: "Location not found" }, { status: 404 });

  // Orders reference this location (SET NULL on delete), so removal is safe.
  await prisma.deliveryLocation.delete({ where: { id } });
  revalidateTag(CACHE_TAGS.locations);
  await audit({
    actor: actorFrom(s),
    action: "location.deleted",
    entityType: "deliveryLocation",
    entityId: id,
    summary: `Deleted delivery location "${location.name}"`,
    req,
  });
  return NextResponse.json({ ok: true });
}
