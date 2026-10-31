import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";

export const runtime = "nodejs";

/** DELETE — remove a hand-added template (synced ones are managed in WhatsApp Manager). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const t = await prisma.waTemplate.findUnique({ where: { id } });
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (t.source !== "manual") return NextResponse.json({ error: "Templates synced from Meta are managed in WhatsApp Manager." }, { status: 409 });
  await prisma.waTemplate.delete({ where: { id } });
  await audit({ actor: actorFrom(s), action: "whatsapp.template_removed", entityType: "waTemplate", entityId: id, summary: `Removed WhatsApp template ${t.name} (${t.language})`, req });
  return NextResponse.json({ ok: true });
}
