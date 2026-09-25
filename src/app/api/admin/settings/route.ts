import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { normalizeScanSteps } from "@/lib/order-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Operational settings for staff screens (never cached, never public):
 * the QR-scan workflow. Kitchen staff may read; only admins may change.
 */
async function load() {
  const s =
    (await prisma.storeSetting.findUnique({ where: { id: 1 } })) ??
    (await prisma.storeSetting.create({ data: { id: 1, acceptingOrders: true } }));
  return { scanSteps: normalizeScanSteps(s.scanSteps) };
}

export async function GET() {
  const s = await getSession();
  if (!s || (s.role !== "admin" && s.role !== "kitchen")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return NextResponse.json(await load());
}

const schema = z.object({
  scanSteps: z.array(z.enum(["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"])).max(4).optional(),
});

export async function PATCH(req: Request) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid settings" }, { status: 400 });

  await load(); // make sure the row exists
  const data: { scanSteps?: ReturnType<typeof normalizeScanSteps> } = {};
  if (parsed.data.scanSteps) data.scanSteps = normalizeScanSteps(parsed.data.scanSteps);

  await prisma.storeSetting.update({ where: { id: 1 }, data });
  const out = await load();
  await audit({
    actor: actorFrom(s),
    action: "settings.updated",
    entityType: "storeSetting",
    summary: data.scanSteps ? `QR scan workflow set to ${out.scanSteps.join(" → ")}` : "Updated operational settings",
    metadata: { ...data },
    req,
  });
  return NextResponse.json(out);
}
