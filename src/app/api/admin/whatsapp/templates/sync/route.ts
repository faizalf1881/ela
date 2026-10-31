import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { syncTemplates } from "@/lib/wa-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — fetch the latest templates and their approval status from Meta. */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const r = await syncTemplates();
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
  await audit({ actor: actorFrom(s), action: "whatsapp.templates_synced", entityType: "waTemplate", summary: `Synced ${r.total} WhatsApp templates (${r.approved} approved)`, metadata: r, req });
  return NextResponse.json(r);
}
