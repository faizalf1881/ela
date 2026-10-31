import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { audit, actorFrom } from "@/lib/audit";
import { templateDTO } from "@/lib/wa-templates";
import { whatsappConfigured } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — every known template; ?sendable=1 only those staff can send now. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sendableOnly = new URL(req.url).searchParams.get("sendable") === "1";
  const rows = await prisma.waTemplate.findMany({ where: { NOT: { status: "DELETED" } }, orderBy: [{ status: "asc" }, { name: "asc" }] });
  const templates = rows.map(templateDTO).filter((t) => !sendableOnly || t.sendable);
  const lastSync = rows.filter((r) => r.source === "meta").reduce<Date | null>((n, r) => (!n || r.syncedAt > n ? r.syncedAt : n), null);
  return NextResponse.json({ templates, canSync: Boolean(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID), configured: whatsappConfigured(), lastSync });
}

const schema = z.object({
  name: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Template names use lower-case letters, digits and _ — exactly as in WhatsApp Manager"),
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, "Language codes look like en, en_US or ml"),
  category: z.enum(["MARKETING", "UTILITY"]),
  header: z.string().trim().max(60).optional().default(""),
  body: z.string().trim().min(1, "Paste the template's message").max(1024),
  footer: z.string().trim().max(60).optional().default(""),
});

/**
 * POST — add an approved template by hand, for accounts where the business
 * account id isn't configured. It must match WhatsApp Manager exactly, or
 * WhatsApp will refuse it when sent.
 */
export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (s.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Check the template details" }, { status: 400 });
  const d = parsed.data;
  if (await prisma.waTemplate.findUnique({ where: { name_language: { name: d.name, language: d.language } } })) {
    return NextResponse.json({ error: "A template with this name and language already exists." }, { status: 409 });
  }
  const named = /\{\{\s*[a-z_][a-z0-9_]*\s*\}\}/i.test(`${d.header} ${d.body}`) && !/\{\{\s*\d+\s*\}\}/.test(`${d.header} ${d.body}`);
  const components = [
    ...(d.header ? [{ type: "HEADER", format: "TEXT", text: d.header }] : []),
    { type: "BODY", text: d.body },
    ...(d.footer ? [{ type: "FOOTER", text: d.footer }] : []),
  ];
  const t = await prisma.waTemplate.create({
    data: { name: d.name, language: d.language, category: d.category, status: "APPROVED", parameterFormat: named ? "NAMED" : "POSITIONAL", components: components as Prisma.InputJsonValue, source: "manual" },
  });
  await audit({ actor: actorFrom(s), action: "whatsapp.template_added", entityType: "waTemplate", entityId: t.id, summary: `Added WhatsApp template ${t.name} (${t.language})`, req });
  return NextResponse.json({ template: templateDTO(t) }, { status: 201 });
}
