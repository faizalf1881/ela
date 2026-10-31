import "server-only";
import { after } from "next/server";
import type { Prisma, WaCampaign } from "@prisma/client";
import { prisma } from "./db";
import { sendWhatsApp, whatsappConfigured, type GraphResult } from "./whatsapp";
import { explainWhatsAppError } from "./order-notify";
import { buildComponents, previewText, renderPreview, templateVariables, type TemplateLike } from "./wa-template-utils";
import { siteUrl } from "./payments";

/**
 * Bulk WhatsApp campaigns (spec #3–#5), within WhatsApp's rules:
 * - only approved templates (the one kind of message allowed to people who
 *   haven't written to us in the last 24 hours);
 * - only to people the admin confirms agreed to hear from us, never to anyone
 *   who replied STOP or turned off marketing in WhatsApp;
 * - sent steadily in batches, well under WhatsApp's per-second limits, each
 *   person at most once, and every message tracked to delivered / read.
 */

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/** A sheet cell → a WhatsApp number (digits with country code), or why not. */
export function validateMobile(raw: unknown): { ok: true; phone: string } | { ok: false; reason: string } {
  let s = raw === null || raw === undefined ? "" : typeof raw === "number" ? raw.toFixed(0) : String(raw).trim();
  if (!s) return { ok: false, reason: "No number" };
  if (/^\d(\.\d+)?e\+\d+$/i.test(s)) s = Number(s).toFixed(0); // 9.19876543210E+11 from a spreadsheet
  if (!/^\+?[\d\s().\-/]+$/.test(s)) return { ok: false, reason: "Not a phone number" };
  let d = s.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) return /^[6-9]/.test(d) ? { ok: true, phone: `91${d}` } : { ok: false, reason: "Not a mobile number (Indian mobiles start with 6–9)" };
  if (d.length === 12 && d.startsWith("91")) return /^91[6-9]/.test(d) ? { ok: true, phone: d } : { ok: false, reason: "Not a mobile number (Indian mobiles start with 6–9)" };
  if (d.length < 10) return { ok: false, reason: "Too short" };
  if (d.length > 15) return { ok: false, reason: "Too long" };
  if (d.startsWith("0")) return { ok: false, reason: "Add the country code" };
  return { ok: true, phone: d };
}

const cleanName = (v: unknown) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, 80) : null;
};

export type ImportRow = { phone: unknown; name?: unknown; data?: Record<string, unknown>; row?: number; customerId?: string };
export type ImportReport = { added: number; invalid: { row: number; value: string; reason: string }[]; duplicates: number; alreadyAdded: number; optedOut: number };

/** Adds people to a draft campaign: each valid number once, never anyone who opted out. */
export async function addRecipients(campaignId: string, rows: ImportRow[], source: "file" | "crm"): Promise<ImportReport> {
  const report: ImportReport = { added: 0, invalid: [], duplicates: 0, alreadyAdded: 0, optedOut: 0 };
  const seen = new Map<string, ImportRow>();
  rows.forEach((r, i) => {
    const v = validateMobile(r.phone);
    if (!v.ok) {
      report.invalid.push({ row: r.row ?? i + 2, value: String(r.phone ?? "").slice(0, 40), reason: v.reason });
      return;
    }
    if (seen.has(v.phone)) report.duplicates++;
    else seen.set(v.phone, r);
  });
  const phones = [...seen.keys()];
  const [existing, opted, customers] = await Promise.all([
    prisma.waCampaignRecipient.findMany({ where: { campaignId, phone: { in: phones } }, select: { phone: true } }),
    prisma.waOptOut.findMany({ where: { phone: { in: phones } }, select: { phone: true } }),
    prisma.customer.findMany({ where: { phone: { in: phones } }, select: { id: true, phone: true, name: true } }),
  ]);
  const have = new Set(existing.map((e) => e.phone));
  const out = new Set(opted.map((o) => o.phone));
  const crm = new Map(customers.map((c) => [c.phone, c]));
  const data: Prisma.WaCampaignRecipientCreateManyInput[] = [];
  for (const [phone, r] of seen) {
    if (have.has(phone)) report.alreadyAdded++;
    else if (out.has(phone)) report.optedOut++;
    else
      data.push({
        campaignId,
        phone,
        name: cleanName(r.name) ?? crm.get(phone)?.name ?? null,
        data: r.data ? (r.data as Prisma.InputJsonValue) : undefined,
        customerId: r.customerId ?? crm.get(phone)?.id ?? null,
        source,
      });
  }
  for (let i = 0; i < data.length; i += 1000) {
    report.added += (await prisma.waCampaignRecipient.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true })).count;
  }
  return report;
}

// ---------------------------------------------------------------------------
// Template variables per person
// ---------------------------------------------------------------------------

export type ParamSource = { source: "name" | "first_name" | "phone" | "column" | "text"; value?: string; fallback?: string };

export function campaignTemplate(c: Pick<WaCampaign, "templateName" | "templateLanguage" | "templateCategory" | "templateFormat" | "components">): TemplateLike {
  return { name: c.templateName, language: c.templateLanguage, category: c.templateCategory, parameterFormat: c.templateFormat, components: c.components };
}

/** The values for one person: their name, a sheet column, or the same text for everyone. */
export function recipientValues(c: Pick<WaCampaign, "params">, r: { phone: string; name: string | null; data: Prisma.JsonValue | null }): Record<string, string> {
  const params = (c.params ?? {}) as Record<string, ParamSource>;
  const values: Record<string, string> = {};
  for (const [key, p] of Object.entries(params)) {
    let v = "";
    if (p.source === "name") v = r.name ?? "";
    else if (p.source === "first_name") v = (r.name ?? "").trim().split(/\s+/)[0] ?? "";
    else if (p.source === "phone") v = `+${r.phone}`;
    else if (p.source === "column") v = String(((r.data ?? {}) as Record<string, unknown>)[p.value ?? ""] ?? "");
    else v = p.value ?? "";
    values[key] = v.trim() || (p.fallback ?? "").trim();
  }
  return values;
}

/** What still has to be set before a campaign can go out. */
export function mappingProblems(c: Pick<WaCampaign, "params" | "templateName" | "templateLanguage" | "templateCategory" | "templateFormat" | "components">): string[] {
  const params = (c.params ?? {}) as Record<string, ParamSource>;
  const problems: string[] = [];
  for (const v of templateVariables(campaignTemplate(c))) {
    const p = params[v.key];
    if (!p) problems.push(`Choose what goes in ${v.label}.`);
    else if (p.source === "text" && !p.value?.trim()) problems.push(`Type the text for ${v.label}.`);
    else if ((p.source === "name" || p.source === "first_name" || p.source === "column") && !p.fallback?.trim()) problems.push(`Add a fallback for ${v.label} (used when a person has no ${p.source === "column" ? "value" : "name"}).`);
    else if (v.kind === "media" && !/^https:\/\//i.test(p.value ?? "")) problems.push("The header image must be a public https:// link.");
  }
  return problems;
}

export async function campaignStats(campaignId: string) {
  const grouped = await prisma.waCampaignRecipient.groupBy({ by: ["status"], where: { campaignId }, _count: { _all: true } });
  const n = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Record<string, number>;
  const get = (k: string) => n[k] ?? 0;
  return {
    total: grouped.reduce((s, g) => s + g._count._all, 0),
    pending: get("PENDING") + get("SENDING"),
    // "Sent" counts everything WhatsApp accepted, however far it has got since.
    sent: get("SENT") + get("DELIVERED") + get("READ"),
    delivered: get("DELIVERED") + get("READ"),
    read: get("READ"),
    failed: get("FAILED"),
    skipped: get("SKIPPED"),
  };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const BATCH = 25;
const CONCURRENCY = 5;
const RUN_MS = 40_000;
/** Errors that would fail for everyone: stop and tell the admin instead of burning through the list. */
const FATAL = new Set([190, 131031, 132001, 132015, 132016, 133010]);

const codeOf = (r: GraphResult) => (r.data as { error?: { code?: number } } | null)?.error?.code;

async function claim(campaignId: string, n: number) {
  return prisma.$queryRaw<{ id: string; phone: string; name: string | null; data: Prisma.JsonValue | null }[]>`
    UPDATE "WaCampaignRecipient" SET "status" = 'SENDING', "updatedAt" = now()
    WHERE "id" IN (
      SELECT "id" FROM "WaCampaignRecipient"
      WHERE "campaignId" = ${campaignId} AND "status" = 'PENDING'
      ORDER BY "createdAt", "id" LIMIT ${n}::int
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "phone", "name", "data"`;
}

type Outcome = "sent" | "failed" | "skipped" | "retry" | { fatal: string };

async function sendOne(c: WaCampaign, tpl: TemplateLike, r: { id: string; phone: string; name: string | null; data: Prisma.JsonValue | null }): Promise<Outcome> {
  if (await prisma.waOptOut.findUnique({ where: { phone: r.phone } })) {
    await prisma.waCampaignRecipient.update({ where: { id: r.id }, data: { status: "SKIPPED", error: "Opted out of marketing messages" } });
    return "skipped";
  }
  const values = recipientValues(c, r);
  const built = buildComponents(tpl, values);
  if (!built.ok) {
    await prisma.waCampaignRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: built.invalid || `Missing: ${built.missing.map((m) => m.label).join(", ")}` } });
    return "failed";
  }
  const body = previewText(renderPreview(tpl, values));
  const res = await sendWhatsApp(r.phone, { type: "template_components", name: c.templateName, lang: c.templateLanguage, components: built.components });
  if (res.ok) {
    await prisma.waCampaignRecipient.update({ where: { id: r.id }, data: { status: "SENT", waMessageId: res.messageId ?? null, sentAt: new Date(), body, error: null, errorCode: null } });
    return "sent";
  }
  const code = codeOf(res);
  if (code !== undefined && FATAL.has(code)) {
    await prisma.waCampaignRecipient.update({ where: { id: r.id }, data: { status: "PENDING" } });
    return { fatal: explainWhatsAppError(res) };
  }
  if (code === 130429) {
    // Too fast for WhatsApp: put it back and slow down.
    await prisma.waCampaignRecipient.update({ where: { id: r.id }, data: { status: "PENDING" } });
    return "retry";
  }
  if (code === 131050) await optOut(r.phone, "whatsapp");
  await prisma.waCampaignRecipient.update({ where: { id: r.id }, data: { status: "FAILED", error: explainWhatsAppError(res), errorCode: code ?? null, body } });
  return "failed";
}

/**
 * Sends the next part of a campaign for at most `budgetMs`. A lease on the
 * campaign row means only one run sends at a time; recipients are claimed
 * row by row (SKIP LOCKED), so nobody is ever sent the message twice.
 */
export async function processCampaign(campaignId: string, budgetMs = RUN_MS): Promise<{ ran: boolean; sent: number; remaining: number; done: boolean; stopped: string | null }> {
  const lease = await prisma.waCampaign.updateMany({
    where: { id: campaignId, status: "SENDING", lastError: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] },
    data: { leaseUntil: new Date(Date.now() + budgetMs + 20_000) },
  });
  if (lease.count === 0) return { ran: false, sent: 0, remaining: 0, done: false, stopped: null };
  let sent = 0;
  let stopped: string | null = null;
  let remaining = 0;
  try {
    // A send interrupted half-way (crash, timeout) may have gone out: never resend it.
    await prisma.waCampaignRecipient.updateMany({
      where: { campaignId, status: "SENDING", updatedAt: { lt: new Date(Date.now() - 120_000) } },
      data: { status: "FAILED", error: "Sending was interrupted — not retried, so nobody gets it twice." },
    });
    const c = await prisma.waCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    if (!whatsappConfigured()) stopped = "WhatsApp is not configured on this server.";
    const tpl = campaignTemplate(c);
    const deadline = Date.now() + budgetMs;
    while (!stopped && Date.now() < deadline) {
      const batch = await claim(campaignId, BATCH);
      if (!batch.length) break;
      let slow = false;
      for (let i = 0; i < batch.length; i += CONCURRENCY) {
        const group = batch.slice(i, i + CONCURRENCY);
        if (stopped || slow) {
          await prisma.waCampaignRecipient.updateMany({ where: { id: { in: group.map((g) => g.id) }, status: "SENDING" }, data: { status: "PENDING" } });
          continue;
        }
        for (const o of await Promise.all(group.map((r) => sendOne(c, tpl, r)))) {
          if (o === "sent") sent++;
          else if (o === "retry") slow = true;
          else if (typeof o === "object") stopped = o.fatal;
        }
      }
      if (slow) await new Promise((r) => setTimeout(r, 2000));
      const now = await prisma.waCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
      if (now?.status !== "SENDING") break; // cancelled
    }
  } finally {
    // Always release the lease — and finish the campaign once nobody is left.
    remaining = await prisma.waCampaignRecipient.count({ where: { campaignId, status: { in: ["PENDING", "SENDING"] } } });
    const done = !stopped && remaining === 0;
    await prisma.waCampaign.updateMany({
      where: { id: campaignId, status: "SENDING" },
      data: { leaseUntil: null, ...(stopped ? { lastError: stopped } : {}), ...(done ? { status: "COMPLETED", completedAt: new Date() } : {}) },
    });
  }
  return { ran: true, sent, remaining, done: !stopped && remaining === 0, stopped };
}

/**
 * Sends the next part now and, when there is more, hands it to a fresh
 * request (each server run is time-limited). Without CRON_SECRET the
 * campaign page carries it on while it is open, and the daily job resumes it.
 */
export async function runCampaign(campaignId: string) {
  const r = await processCampaign(campaignId);
  if (r.ran && !r.done && !r.stopped && r.remaining > 0 && process.env.CRON_SECRET) {
    await fetch(`${siteUrl()}/api/admin/campaigns/${campaignId}/process`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }
  return r;
}

/** Keeps a sending campaign moving (after the response), if nothing is sending it right now. */
export async function continueCampaign(c: Pick<WaCampaign, "id" | "status" | "leaseUntil" | "lastError">) {
  if (c.status !== "SENDING" || c.lastError || (c.leaseUntil && c.leaseUntil > new Date())) return false;
  after(() => runCampaign(c.id).then(() => undefined));
  return true;
}

/** For the daily job: picks up any campaign that stopped moving. */
export async function resumeCampaigns() {
  const stuck = await prisma.waCampaign.findMany({ where: { status: "SENDING", lastError: null, OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] } });
  for (const c of stuck) await continueCampaign(c);
  return stuck.length;
}

// ---------------------------------------------------------------------------
// Delivery receipts and opt-outs
// ---------------------------------------------------------------------------

const RANK: Record<string, number> = { PENDING: 0, SENDING: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/** WhatsApp's sent / delivered / read / failed for a campaign message (webhook `statuses`). */
export async function applyCampaignReceipt(r: { id: string; status: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string }[] }): Promise<boolean> {
  const rec = await prisma.waCampaignRecipient.findUnique({ where: { waMessageId: r.id } });
  if (!rec) return false;
  const at = r.timestamp ? new Date(Number(r.timestamp) * 1000) : new Date();
  if (r.status === "failed") {
    const e = r.errors?.[0];
    const error = explainWhatsAppError({ ok: false, status: 400, data: { error: { code: e?.code, message: e?.message || e?.title } } });
    await prisma.waCampaignRecipient.update({ where: { id: rec.id }, data: { status: "FAILED", error, errorCode: e?.code ?? null } });
    if (e?.code === 131050) await optOut(rec.phone, "whatsapp");
    return true;
  }
  const next = ({ sent: "SENT", delivered: "DELIVERED", read: "READ" } as const)[r.status as "sent" | "delivered" | "read"];
  if (!next || rec.status === "FAILED" || rec.status === "SKIPPED" || RANK[next] <= (RANK[rec.status] ?? 0)) return true;
  await prisma.waCampaignRecipient.update({
    where: { id: rec.id },
    data: { status: next, ...(next === "DELIVERED" ? { deliveredAt: at } : {}), ...(next === "READ" ? { readAt: at, deliveredAt: rec.deliveredAt ?? at } : {}) },
  });
  return true;
}

export async function optOut(phone: string, source: "keyword" | "whatsapp" | "admin") {
  await prisma.waOptOut.upsert({ where: { phone }, create: { phone, source }, update: {} });
}
export async function optIn(phone: string) {
  await prisma.waOptOut.deleteMany({ where: { phone } });
}

const STOP_RE = /^(stop|unsubscribe|stop promotions|stop offers|stop messages)$/i;
const START_RE = /^(start|subscribe|resume|unstop)$/i;

/**
 * STOP / START replies (and the "Stop promotions" button of marketing
 * templates). Returns the confirmation to send, or null when the message is
 * something else.
 */
export async function optKeyword(phone: string, body: string): Promise<string | null> {
  const t = body.trim().replace(/[.!]+$/, "");
  if (STOP_RE.test(t)) {
    await optOut(phone, "keyword");
    return "Done — you won't get offers from Ela & Co. on WhatsApp any more. You'll still get updates about your own orders. Reply START to get offers again.";
  }
  if (START_RE.test(t) && (await prisma.waOptOut.findUnique({ where: { phone } }))) {
    await optIn(phone);
    return "Welcome back! You'll get our offers on WhatsApp again. Reply STOP any time to stop them.";
  }
  return null;
}
