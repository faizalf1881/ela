import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { toDbDate } from "@/lib/delivery";

export const runtime = "nodejs";

const updateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  startMinutes: z.number().int().min(0).max(1439).optional(),
  endMinutes: z.number().int().min(1).max(1440).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  // Close/reopen this slot for one date (optionally only in one delivery area).
  block: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), locationId: z.string().nullable().optional(), reason: z.string().max(120).optional() }).optional(),
  unblock: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), locationId: z.string().nullable().optional() }).optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

  const existing = await prisma.deliverySlot.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Slot not found" }, { status: 404 });

  const { block, unblock, ...fields } = parsed.data;
  const start = fields.startMinutes ?? existing.startMinutes;
  const end = fields.endMinutes ?? existing.endMinutes;
  if (end <= start) return NextResponse.json({ error: "End time must be after the start time" }, { status: 400 });

  if (block) {
    await prisma.slotBlock
      .create({ data: { slotId: id, date: toDbDate(block.date), locationId: block.locationId ?? null, reason: block.reason ?? null } })
      .catch(() => {}); // unique constraint — already blocked
    await audit({ actor: actorFrom(s), action: "slot.blocked", entityType: "deliverySlot", entityId: id, summary: `Closed "${existing.label}" on ${block.date}`, metadata: { ...block }, req });
  }
  if (unblock) {
    await prisma.slotBlock.deleteMany({ where: { slotId: id, date: toDbDate(unblock.date), locationId: unblock.locationId ?? null } });
    await audit({ actor: actorFrom(s), action: "slot.unblocked", entityType: "deliverySlot", entityId: id, summary: `Reopened "${existing.label}" on ${unblock.date}`, metadata: { ...unblock }, req });
  }

  const slot = Object.keys(fields).length
    ? await prisma.deliverySlot.update({ where: { id }, data: fields, include: { blocks: true } })
    : await prisma.deliverySlot.findUnique({ where: { id }, include: { blocks: true } });

  if (Object.keys(fields).length) {
    await audit({ actor: actorFrom(s), action: "slot.updated", entityType: "deliverySlot", entityId: id, summary: `Updated delivery slot "${slot?.label}"`, metadata: { changes: fields }, req });
  }
  return NextResponse.json({ slot });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const slot = await prisma.deliverySlot.findUnique({ where: { id } });
  if (!slot) return NextResponse.json({ error: "Slot not found" }, { status: 404 });

  // Orders reference the slot for their delivery record — keep history by hiding
  // the slot instead of deleting it once it has been used.
  const used = await prisma.order.count({ where: { deliverySlotId: id } });
  if (used > 0) {
    const updated = await prisma.deliverySlot.update({ where: { id }, data: { active: false } });
    await audit({ actor: actorFrom(s), action: "slot.deactivated", entityType: "deliverySlot", entityId: id, summary: `Hid delivery slot "${slot.label}" (${used} past orders)`, req });
    return NextResponse.json({ slot: updated, deactivated: true, message: `${used} order(s) used this slot, so it was hidden instead of deleted.` });
  }

  await prisma.deliverySlot.delete({ where: { id } });
  await audit({ actor: actorFrom(s), action: "slot.deleted", entityType: "deliverySlot", entityId: id, summary: `Deleted delivery slot "${slot.label}"`, req });
  return NextResponse.json({ ok: true });
}
