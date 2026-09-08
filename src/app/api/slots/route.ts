import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

// GET /api/slots — public: active slots. ?all=1 (admin): everything + blocks.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("all") === "1") {
    const s = await getSession();
    if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const slots = await prisma.deliverySlot.findMany({
      orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }],
      include: { blocks: { orderBy: { date: "asc" } } },
    });
    return NextResponse.json({ slots });
  }

  const slots = await prisma.deliverySlot.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }],
  });
  return NextResponse.json({ slots });
}

const createSchema = z.object({
  label: z.string().trim().min(1).max(60),
  startMinutes: z.number().int().min(0).max(1439),
  endMinutes: z.number().int().min(1).max(1440),
  active: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
});

// POST /api/slots — admin only.
export async function POST(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  if (parsed.data.endMinutes <= parsed.data.startMinutes) {
    return NextResponse.json({ error: "End time must be after the start time" }, { status: 400 });
  }

  const slot = await prisma.deliverySlot.create({ data: parsed.data });
  await audit({
    actor: actorFrom(s),
    action: "slot.created",
    entityType: "deliverySlot",
    entityId: slot.id,
    summary: `Added delivery slot "${slot.label}"`,
    req,
  });
  return NextResponse.json({ slot }, { status: 201 });
}
