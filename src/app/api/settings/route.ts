import { NextResponse } from "next/server";
import { z } from "zod";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { getStoreSetting, CACHE_TAGS } from "@/lib/menu-cache";

async function getOrCreate() {
  return (
    (await prisma.storeSetting.findUnique({ where: { id: 1 } })) ??
    (await prisma.storeSetting.create({ data: { id: 1, acceptingOrders: true } }))
  );
}

// GET /api/settings — public (store open state for banners/checkout). Cached.
export async function GET() {
  const s = await getStoreSetting();
  return NextResponse.json({
    acceptingOrders: s?.acceptingOrders ?? true,
    closedMessage: s?.closedMessage ?? null,
  });
}

const schema = z.object({
  acceptingOrders: z.boolean().optional(),
  closedMessage: z.string().max(300).nullable().optional(),
});

// PATCH /api/settings — admin only.
export async function PATCH(req: Request) {
  const session = await getSession();
  if (session?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  await getOrCreate();
  const s = await prisma.storeSetting.update({ where: { id: 1 }, data: parsed.data });
  revalidateTag(CACHE_TAGS.settings); // bust cached store status immediately
  await audit({
    actor: actorFrom(session),
    action: "settings.updated",
    entityType: "storeSetting",
    summary: parsed.data.acceptingOrders === undefined ? "Updated store settings" : s.acceptingOrders ? "Store OPENED (accepting orders)" : "Store CLOSED (orders paused)",
    metadata: { ...parsed.data },
    req,
  });
  return NextResponse.json({ acceptingOrders: s.acceptingOrders, closedMessage: s.closedMessage });
}
