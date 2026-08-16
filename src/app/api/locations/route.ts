import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { CACHE_TAGS } from "@/lib/menu-cache";

// GET /api/locations — public: active locations. ?all=1 (admin): everything.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const wantAll = searchParams.get("all") === "1";

  if (wantAll) {
    const s = await getSession();
    if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const locations = await prisma.deliveryLocation.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    return NextResponse.json({ locations });
  }

  const locations = await prisma.deliveryLocation.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ locations });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  area: z.string().max(120).nullable().optional(),
  deliveryFee: z.number().int().min(0).max(100000).optional().default(40),
  active: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
});

// POST /api/locations — admin only.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const location = await prisma.deliveryLocation.create({
    data: { ...parsed.data, area: parsed.data.area ?? null },
  });
  revalidateTag(CACHE_TAGS.locations);
  await audit({
    actor: actorFrom(s),
    action: "location.created",
    entityType: "deliveryLocation",
    entityId: location.id,
    summary: `Added delivery location "${location.name}"`,
    metadata: { ...parsed.data },
    req,
  });
  return NextResponse.json({ location }, { status: 201 });
}
