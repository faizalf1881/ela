"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Megaphone, Plus, Loader2, RefreshCw, Trash2, X, ShieldCheck, CircleAlert } from "lucide-react";
import { CategoryPill, useSendableTemplates, type TemplateRow } from "@/components/staff/TemplatePicker";
import { CampaignEditor } from "@/components/staff/CampaignEditor";
import { STATUS_PILL, limitText } from "@/components/staff/campaign-shared";
import { renderPreview } from "@/lib/wa-template-utils";

type Stats = { total: number; pending: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
type CampaignRow = { id: string; name: string; templateName: string; templateCategory: string; status: string; lastError: string | null; createdAt: string; startedAt: string | null; completedAt: string | null; stats: Stats };
type Health = { ok: boolean; quality?: string; limit?: string; name?: string; number?: string; error?: string };

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Admin → Bulk WhatsApp (spec #3–#5): campaigns with approved templates, and the templates themselves. */
export function CampaignsBoard() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") === "templates" ? "templates" : "campaigns";
  const openId = params.get("id");
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/admin/whatsapp/health", { cache: "no-store" })
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ ok: false }));
  }, []);

  const go = (q: Record<string, string | null>) => {
    const u = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(q)) (v === null ? u.delete(k) : u.set(k, v));
    router.push(`${pathname}${u.toString() ? `?${u}` : ""}`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Bulk WhatsApp</h1>
          <p className="mt-1 text-sm text-muted-foreground">Send an approved template to your customers and see who received and read it.</p>
        </div>
        <HealthBadge health={health} />
      </div>

      <div className="mt-5 flex gap-2">
        {[
          { k: "campaigns", label: "Campaigns" },
          { k: "templates", label: "Templates" },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => go({ tab: t.k === "campaigns" ? null : t.k, id: null })}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === t.k ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80 hover:bg-secondary"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "templates" ? (
          <TemplatesTab />
        ) : openId ? (
          <CampaignEditor id={openId} health={health} onBack={() => go({ id: null })} />
        ) : (
          <CampaignList onOpen={(id) => go({ id })} />
        )}
      </div>
    </div>
  );
}

function HealthBadge({ health }: { health: Health | null }) {
  if (!health) return <div className="h-12 w-56 animate-pulse rounded-2xl bg-muted" />;
  if (!health.ok) return <div className="rounded-2xl bg-muted px-3 py-2 text-xs text-muted-foreground">WhatsApp number status unavailable</div>;
  const q = (health.quality || "").toUpperCase();
  return (
    <div className="rounded-2xl border border-border bg-card px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <ShieldCheck className={`h-3.5 w-3.5 ${q === "GREEN" ? "text-green-600" : q === "YELLOW" ? "text-amber-600" : q === "RED" ? "text-destructive" : "text-muted-foreground"}`} />
        {health.name || "WhatsApp number"} · quality {q ? q.toLowerCase() : "unknown"}
      </div>
      {health.limit && <div className="text-muted-foreground">Can start up to {limitText(health.limit)} new conversations a day</div>}
    </div>
  );
}

function Bar({ stats }: { stats: Stats }) {
  const t = Math.max(1, stats.total);
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted" title={`${stats.read} read · ${stats.delivered} delivered · ${stats.sent} sent · ${stats.failed} failed`}>
      <span className="bg-blue-500" style={{ width: `${(stats.read / t) * 100}%` }} />
      <span className="bg-green-600" style={{ width: `${((stats.delivered - stats.read) / t) * 100}%` }} />
      <span className="bg-forest/40" style={{ width: `${((stats.sent - stats.delivered) / t) * 100}%` }} />
      <span className="bg-destructive" style={{ width: `${(stats.failed / t) * 100}%` }} />
    </div>
  );
}

function CampaignList({ onOpen }: { onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<CampaignRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/campaigns", { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    setRows(d.campaigns ?? []);
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div>
      <div className="flex justify-end">
        <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> New campaign
        </button>
      </div>
      {rows === null ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-card" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          <Megaphone className="mx-auto h-8 w-8" />
          <p className="mt-3">No campaigns yet. Start one to send an approved template to many customers at once.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((c) => (
            <button key={c.id} onClick={() => onOpen(c.id)} className="block w-full rounded-2xl border border-border bg-card p-4 text-left hover:border-forest/40">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_PILL[c.status]}`}>{c.status.toLowerCase()}</span>
                    {c.lastError && <span className="text-[11px] text-destructive">paused — {c.lastError.slice(0, 60)}</span>}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {c.templateName} · <CategoryPill category={c.templateCategory} /> · {when(c.startedAt ?? c.createdAt)}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground tabular-nums">
                  <div className="text-sm font-medium text-foreground">{c.stats.total} recipients</div>
                  {c.status !== "DRAFT" && (
                    <div>
                      {c.stats.sent} sent · {c.stats.delivered} delivered · {c.stats.read} read{c.stats.failed ? ` · ${c.stats.failed} failed` : ""}
                    </div>
                  )}
                </div>
              </div>
              {c.status !== "DRAFT" && (
                <div className="mt-3">
                  <Bar stats={c.stats} />
                </div>
              )}
            </button>
          ))}
        </div>
      )}
      {creating && <NewCampaignDialog onClose={() => setCreating(false)} onCreated={onOpen} />}
    </div>
  );
}

function NewCampaignDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { templates, canSync, syncing, sync } = useSendableTemplates();
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = templates?.find((t) => t.id === templateId) ?? null;

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, templateId }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not create");
      onCreated(d.campaign.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not create");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-lg rounded-t-3xl bg-card p-5 shadow-elegant ring-1 ring-border sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl text-foreground">New campaign</h2>
          <button onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Campaign name (only you see it)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Onam sadya pre-booking" className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
          </label>
          <label className="block">
            <span className="flex items-center justify-between text-xs text-muted-foreground">
              Approved template
              {canSync && (
                <button type="button" onClick={sync} disabled={syncing} className="inline-flex items-center gap-1 text-forest hover:underline">
                  <RefreshCw className={`h-3 w-3 ${syncing ? "animate-spin" : ""}`} /> Sync from Meta
                </button>
              )}
            </span>
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base sm:text-sm">
              <option value="">{templates === null ? "Loading…" : templates.length ? "Choose a template…" : "No approved templates yet"}</option>
              {(templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.category.toLowerCase()}, {t.language})
                </option>
              ))}
            </select>
          </label>
          {chosen && <p className="rounded-xl bg-muted px-3 py-2 text-xs text-foreground">{renderPreview(chosen, {}).body}</p>}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button onClick={create} disabled={busy || !name.trim() || !templateId} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Continue
          </button>
        </div>
      </div>
    </div>
  );
}

type AllTemplate = TemplateRow & { syncedAt: string };

/** All templates and their approval status; sync from Meta or add one by hand. */
function TemplatesTab() {
  const [data, setData] = useState<{ templates: AllTemplate[]; canSync: boolean; lastSync: string | null } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", language: "en", category: "MARKETING", header: "", body: "", footer: "" });
  const load = useCallback(async () => {
    const res = await fetch("/api/admin/whatsapp/templates", { cache: "no-store" });
    setData(await res.json());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/whatsapp/templates/sync", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not sync");
      toast.success(`${d.total} templates synced — ${d.approved} approved`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sync");
    } finally {
      setSyncing(false);
    }
  }
  async function add() {
    const res = await fetch("/api/admin/whatsapp/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json();
    if (!res.ok) return toast.error(d.error || "Could not add");
    toast.success("Template added");
    setAdding(false);
    setForm({ name: "", language: "en", category: "MARKETING", header: "", body: "", footer: "" });
    await load();
  }
  async function remove(t: AllTemplate) {
    if (!confirm(`Remove ${t.name}?`)) return;
    const res = await fetch(`/api/admin/whatsapp/templates/${t.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error((await res.json()).error || "Could not remove");
    await load();
  }

  const field = "mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-gold/60";
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4 text-sm">
        <div className="text-muted-foreground">
          Templates are written and approved in Meta&apos;s WhatsApp Manager. {data?.lastSync ? `Last synced ${when(data.lastSync)}.` : ""}
          {!data?.canSync && " Add WHATSAPP_BUSINESS_ACCOUNT_ID to sync them automatically, or add them here by hand."}
        </div>
        <div className="flex gap-2">
          {data?.canSync && (
            <button onClick={sync} disabled={syncing} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sync from Meta
            </button>
          )}
          <button onClick={() => setAdding((v) => !v)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs hover:bg-muted">
            <Plus className="h-3.5 w-3.5" /> Add by hand
          </button>
        </div>
      </div>

      {adding && (
        <div className="mt-3 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Name (exactly as in WhatsApp Manager)</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="onam_offer" className={field} />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Language</span>
            <input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="en" className={field} />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Category</span>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={field}>
              <option value="MARKETING">Marketing</option>
              <option value="UTILITY">Utility</option>
            </select>
          </label>
          <label className="block sm:col-span-3">
            <span className="text-xs text-muted-foreground">Header (optional)</span>
            <input value={form.header} onChange={(e) => setForm({ ...form, header: e.target.value })} maxLength={60} className={field} />
          </label>
          <label className="block sm:col-span-3">
            <span className="text-xs text-muted-foreground">Message — use {"{{1}}"}, {"{{2}}"}… where WhatsApp Manager shows variables</span>
            <textarea value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} rows={3} maxLength={1024} className={field} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs text-muted-foreground">Footer (optional)</span>
            <input value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} maxLength={60} className={field} />
          </label>
          <div className="flex items-end justify-end">
            <button onClick={add} className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground">
              Add template
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        {data === null ? (
          <div className="h-24 animate-pulse rounded-2xl bg-muted" />
        ) : data.templates.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No templates yet.</p>
        ) : (
          data.templates.map((t) => (
            <div key={t.id} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{t.name}</span>
                  <CategoryPill category={t.category} />
                  <span className="text-[11px] text-muted-foreground">{t.language}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${t.status === "APPROVED" ? "bg-green-500/15 text-green-700" : "bg-muted text-muted-foreground"}`}>{t.status.toLowerCase()}</span>
                  {t.source === "manual" && <span className="text-[10px] uppercase text-muted-foreground">added by hand</span>}
                </div>
                {t.source === "manual" && (
                  <button onClick={() => remove(t)} className="inline-flex h-8 w-8 items-center justify-center rounded-full text-destructive hover:bg-destructive/10" aria-label="Remove template">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{renderPreview(t, {}).body}</p>
              {t.unsupported && (
                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-destructive">
                  <CircleAlert className="h-3 w-3" /> {t.unsupported}
                </p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
