import "server-only";
import type { Prisma, WaTemplate } from "@prisma/client";
import { prisma } from "./db";
import { fetchTemplates } from "./whatsapp";
import { buildComponents, previewText, renderPreview, templateVariables, unsupportedReason } from "./wa-template-utils";

/**
 * Approved WhatsApp templates (spec #2/#3). Synced from Meta when the business
 * account id is configured; otherwise added by hand in Admin. A template is
 * sendable only when it is APPROVED and uses features the panel supports.
 */

export function templateDTO(t: WaTemplate) {
  const reason = unsupportedReason(t);
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    parameterFormat: t.parameterFormat,
    components: t.components,
    source: t.source,
    syncedAt: t.syncedAt,
    variables: templateVariables(t),
    unsupported: reason,
    sendable: t.status === "APPROVED" && !reason,
  };
}

/** Pulls every template from Meta. Templates that disappeared there are kept, marked DELETED. */
export async function syncTemplates(): Promise<{ ok: true; total: number; approved: number; removed: number } | { ok: false; error: string }> {
  const r = await fetchTemplates();
  if (!r.ok) {
    const err = (r.data as { error?: { message?: string; code?: number } } | undefined)?.error;
    return { ok: false, error: err?.code === 190 ? "The WhatsApp access token is invalid or expired." : err?.message || r.error };
  }
  const seen = new Set<string>();
  for (const t of r.templates) {
    if (!t.name || !t.language) continue;
    seen.add(`${t.name}|${t.language}`);
    const data = {
      category: (t.category || "UTILITY").toUpperCase(),
      status: (t.status || "PENDING").toUpperCase(),
      parameterFormat: (t.parameter_format || "POSITIONAL").toUpperCase(),
      components: (t.components ?? []) as Prisma.InputJsonValue,
      metaId: t.id ?? null,
      source: "meta",
      syncedAt: new Date(),
    };
    await prisma.waTemplate.upsert({ where: { name_language: { name: t.name, language: t.language } }, create: { name: t.name, language: t.language, ...data }, update: data });
  }
  const stale = (await prisma.waTemplate.findMany({ where: { source: "meta", NOT: { status: "DELETED" } }, select: { id: true, name: true, language: true } })).filter((t) => !seen.has(`${t.name}|${t.language}`));
  if (stale.length) await prisma.waTemplate.updateMany({ where: { id: { in: stale.map((t) => t.id) } }, data: { status: "DELETED" } });
  return { ok: true, total: r.templates.length, approved: r.templates.filter((t) => (t.status || "").toUpperCase() === "APPROVED").length, removed: stale.length };
}

/** A template ready to send with these values — or why it can't be. */
export async function prepareTemplate(templateId: string, values: Record<string, string>) {
  const t = await prisma.waTemplate.findUnique({ where: { id: templateId } });
  if (!t) return { ok: false as const, error: "Choose a template." };
  if (t.status !== "APPROVED") return { ok: false as const, error: `"${t.name}" isn't approved by WhatsApp yet (${t.status.toLowerCase()}).` };
  const reason = unsupportedReason(t);
  if (reason) return { ok: false as const, error: reason };
  const built = buildComponents(t, values);
  if (!built.ok) return { ok: false as const, error: built.invalid || `Fill in: ${built.missing.map((m) => m.label).join(", ")}` };
  const preview = renderPreview(t, values);
  return { ok: true as const, template: t, components: built.components, preview, text: previewText(preview) };
}
