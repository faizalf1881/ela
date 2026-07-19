import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

// DELETE /api/staff/[id] — admin: remove a kitchen staff account.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (s?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const target = await prisma.staffUser.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role === "ADMIN") {
    return NextResponse.json({ error: "Cannot delete an admin account" }, { status: 400 });
  }

  await prisma.staffUser.delete({ where: { id } });
  await audit({ actor: actorFrom(s), action: "staff.deleted", entityType: "staffUser", entityId: id, summary: `Removed kitchen account "${target.username}"`, metadata: { username: target.username }, req });
  return NextResponse.json({ ok: true });
}
