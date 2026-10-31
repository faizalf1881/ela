"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Upload, Users, Download, Loader2, X, Trash2, Send, CircleAlert, CheckCircle2, Search, StopCircle, Play, FileSpreadsheet } from "lucide-react";
import { TemplateBubble } from "@/components/staff/TemplatePicker";
import { STATUS_PILL, limitText } from "@/components/staff/campaign-shared";
import type { TemplatePreview, TplVar } from "@/lib/wa-template-utils";

type Stats = { total: number; pending: number; sent: number; delivered: number; read: number; failed: number; skipped: number };
type Param = { source: "name" | "first_name" | "phone" | "column" | "text"; value?: string; fallback?: string };
type Recipient = { id: string; phone: string; name: string | null; source: string; status: string; error: string | null; sentAt: string | null; deliveredAt: string | null; readAt: string | null };
type Detail = {
  campaign: { id: string; name: string; status: string; templateName: string; templateCategory: string; templateLanguage: string; params: Record<string, Param>; optInConfirmed: boolean; lastError: string | null; startedAt: string | null; completedAt: string | null };
  stats: Stats;
  variables: TplVar[];
  problems: string[];
  unsupported: string | null;
  preview: TemplatePreview;
  previewFor: { name: string | null; phone: string } | null;
  columns: string[];
  recipients: { items: Recipient[]; total: number; page: number };
};
type Sheet = { columns: string[]; rows: Record<string, string>[]; phoneColumn: string | null; nameColumn: string | null; truncated: boolean };
type Report = { added: number; invalid: { row: number; value: string; reason: string }[]; duplicates: number; alreadyAdded: number; optedOut: number };
type Health = { ok: boolean; limit?: string } | null;

const field = "w-full rounded-xl border border-input bg-background px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-gold/60";
const LIMIT_NUM: Record<string, number> = { TIER_250: 250, TIER_1K: 1000, TIER_2K: 2000, TIER_10K: 10000, TIER_100K: 100000 };
const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const RSTATUS: Record<string, string> = {
  PENDING: "bg-muted text-muted-foreground",
  SENDING: "bg-muted text-muted-foreground",
  SENT: "bg-forest/10 text-forest",
  DELIVERED: "bg-green-500/15 text-green-700",
  READ: "bg-blue-500/10 text-blue-700",
  FAILED: "bg-destructive/10 text-destructive",
  SKIPPED: "bg-muted text-muted-foreground",
};

/** One campaign: set up the list and message, confirm and send — then watch delivery (spec #3–#5). */
export function CampaignEditor({ id, health, onBack }: { id: string; health: Health; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [filter, setFilter] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const u = new URLSearchParams({ page: String(page) });
    if (filter) u.set("status", filter);
    if (q.trim()) u.set("q", q.trim());
    const res = await fetch(`/api/admin/campaigns/${id}?${u}`, { cache: "no-store" });
    if (!res.ok) {
      toast.error("Could not load the campaign");
      return;
    }
    setD(await res.json());
  }, [id, filter, q, page]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  // Live while sending: numbers refresh, and opening the page keeps sending going.
  useEffect(() => {
    if (d?.campaign.status !== "SENDING") return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [d?.campaign.status, load]);

  async function call(key: string, url: string, init: RequestInit, done?: string) {
    setBusy(key);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Something went wrong");
      if (done) toast.success(done);
      await load();
      return j;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return null;
    } finally {
      setBusy(null);
    }
  }

  if (!d) return <div className="h-64 animate-pulse rounded-2xl border border-border bg-card" />;
  const c = d.campaign;
  const draft = c.status === "DRAFT";

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted" aria-label="Back to campaigns">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-serif text-2xl text-foreground">{c.name}</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_PILL[c.status]}`}>{c.status.toLowerCase()}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Template {c.templateName} · {c.templateCategory.toLowerCase()} · {c.templateLanguage}
              {c.startedAt ? ` · started ${time(c.startedAt)}` : ""}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          {c.status === "SENDING" && (
            <button
              onClick={() => confirm("Stop this campaign? People who haven't been sent it yet won't get it.") && call("cancel", `/api/admin/campaigns/${id}/cancel`, { method: "POST" }, "Campaign stopped")}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 rounded-full border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <StopCircle className="h-4 w-4" /> Stop sending
            </button>
          )}
          {!draft && (
            <a href={`/api/admin/campaigns/${id}/export`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
              <Download className="h-4 w-4" /> Export
            </a>
          )}
          {draft && (
            <button
              onClick={async () => {
                if (!confirm("Delete this draft?")) return;
                const res = await fetch(`/api/admin/campaigns/${id}`, { method: "DELETE" });
                if (res.ok) onBack();
                else toast.error((await res.json()).error || "Could not delete");
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" /> Delete draft
            </button>
          )}
        </div>
      </div>

      {!draft && <LiveStats d={d} onResume={() => call("resume", `/api/admin/campaigns/${id}/send`, { method: "POST" }, "Sending resumed")} busy={busy === "resume"} />}

      {draft ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <RecipientsStep d={d} id={id} reload={load} />
          <MessageStep d={d} id={id} reload={load} />
          <ReviewStep d={d} id={id} health={health} call={call} busy={busy} />
        </div>
      ) : (
        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_22rem]">
          <RecipientTable d={d} filter={filter} setFilter={(f) => (setPage(0), setFilter(f))} q={q} setQ={(v) => (setPage(0), setQ(v))} page={page} setPage={setPage} />
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-2 text-xs text-muted-foreground">Message{d.previewFor ? ` (as ${d.previewFor.name || `+${d.previewFor.phone}`} saw it)` : ""}</div>
            <div className="rounded-2xl bg-[#efeae2] p-3">
              <TemplateBubble preview={d.preview} className="ml-auto" />
            </div>
          </div>
        </div>
      )}

      {draft && (
        <div className="mt-4">
          <RecipientTable d={d} filter={filter} setFilter={setFilter} q={q} setQ={(v) => (setPage(0), setQ(v))} page={page} setPage={setPage} onRemove={(rid) => call("rm", `/api/admin/campaigns/${id}/recipients?id=${rid}`, { method: "DELETE" })} />
        </div>
      )}
    </div>
  );
}

function Step({ n, title, sub, done, children }: { n: number; title: string; sub: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${done ? "bg-forest text-white" : "bg-muted text-foreground"}`}>
          {done ? <CheckCircle2 className="h-4 w-4" /> : n}
        </span>
        <div>
          <div className="font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{sub}</div>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function RecipientsStep({ d, id, reload }: { d: Detail; id: string; reload: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/campaigns/import", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not read the file");
      if (!j.rows.length) throw new Error("The file has no rows.");
      setSheet(j);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read the file");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function add(body: unknown, key: string) {
    setBusy(key);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}/recipients`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not add");
      setReport(j.report);
      setSheet(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Step n={1} title="Recipients" sub="Upload an Excel/CSV list or pick customers. Numbers are checked; duplicates and opted-out people are left out." done={d.stats.total > 0}>
      <div className="text-sm text-foreground">
        <strong className="tabular-nums">{d.stats.total.toLocaleString("en-IN")}</strong> recipient{d.stats.total === 1 ? "" : "s"} ready
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => fileRef.current?.click()} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">
          {busy === "upload" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload Excel / CSV
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        <select
          value=""
          disabled={busy !== null}
          onChange={(e) => e.target.value && add({ crm: e.target.value }, "crm")}
          className="rounded-full border border-border bg-background px-3 py-2 text-xs"
          aria-label="Add customers from the CRM"
        >
          <option value="">{busy === "crm" ? "Adding…" : "Add from Customers…"}</option>
          <option value="all">All customers</option>
          <option value="ordered">Customers who have ordered</option>
          <option value="recent">Ordered in the last 90 days</option>
          <option value="members">Active members</option>
        </select>
        <a href="/api/admin/campaigns/sample" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs hover:bg-muted">
          <FileSpreadsheet className="h-3.5 w-3.5" /> Sample sheet
        </a>
        {d.stats.total > 0 && (
          <button
            onClick={async () => {
              if (!confirm("Remove everyone from this list?")) return;
              await fetch(`/api/admin/campaigns/${id}/recipients?all=1`, { method: "DELETE" });
              setReport(null);
              await reload();
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear list
          </button>
        )}
      </div>

      {report && <ImportReport report={report} onClose={() => setReport(null)} />}
      {sheet && <MapColumns sheet={sheet} busy={busy === "add"} onCancel={() => setSheet(null)} onAdd={(rows) => add({ rows }, "add")} />}
    </Step>
  );
}

function ImportReport({ report, onClose }: { report: Report; onClose: () => void }) {
  const [all, setAll] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          <span className="text-green-700">✓ {report.added} added</span>
          <span className={report.invalid.length ? "text-destructive" : "text-muted-foreground"}>✗ {report.invalid.length} invalid</span>
          <span className="text-muted-foreground">{report.duplicates} duplicates</span>
          <span className="text-muted-foreground">{report.alreadyAdded} already in the list</span>
          <span className="text-muted-foreground">{report.optedOut} opted out (left out)</span>
        </div>
        <button onClick={onClose} className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-muted" aria-label="Close report">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {report.invalid.length > 0 && (
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-card p-2">
          {(all ? report.invalid : report.invalid.slice(0, 8)).map((r, i) => (
            <div key={i} className="flex justify-between gap-2 py-0.5">
              <span>
                Row {r.row}: <span className="font-mono">{r.value || "(empty)"}</span>
              </span>
              <span className="text-destructive">{r.reason}</span>
            </div>
          ))}
          {!all && report.invalid.length > 8 && (
            <button onClick={() => setAll(true)} className="mt-1 text-forest hover:underline">
              Show all {report.invalid.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Check which column is the phone number (and the name) before adding a sheet. */
function MapColumns({ sheet, busy, onCancel, onAdd }: { sheet: Sheet; busy: boolean; onCancel: () => void; onAdd: (rows: { phone: string; name: string | null; data: Record<string, string>; row: number }[]) => void }) {
  const [phoneCol, setPhoneCol] = useState(sheet.phoneColumn ?? sheet.columns[0]);
  const [nameCol, setNameCol] = useState(sheet.nameColumn ?? "");
  return (
    <div className="mt-3 rounded-xl border border-gold/40 bg-gold/5 p-3 text-xs">
      <div className="font-medium text-foreground">
        {sheet.rows.length.toLocaleString("en-IN")} rows found{sheet.truncated ? " (only the first 5,000 are used)" : ""}. Check the columns:
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-muted-foreground">WhatsApp number column</span>
          <select value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)} className={`mt-1 ${field}`}>
            {sheet.columns.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-muted-foreground">Name column (optional)</span>
          <select value={nameCol} onChange={(e) => setNameCol(e.target.value)} className={`mt-1 ${field}`}>
            <option value="">— none —</option>
            {sheet.columns.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-normal">Number</th>
              <th className="py-1 font-normal">Name</th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.slice(0, 5).map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="py-1 pr-3 font-mono">{r[phoneCol]}</td>
                <td className="py-1">{nameCol ? r[nameCol] : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-full border border-border px-3 py-1.5 hover:bg-muted">
          Cancel
        </button>
        <button
          onClick={() =>
            onAdd(
              sheet.rows.map((r, i) => ({
                phone: r[phoneCol] ?? "",
                name: nameCol ? r[nameCol] || null : null,
                data: Object.fromEntries(Object.entries(r).filter(([k]) => k !== phoneCol && k !== nameCol)),
                row: i + 2,
              })),
            )
          }
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 font-semibold text-primary-foreground disabled:opacity-60"
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Check and add
        </button>
      </div>
    </div>
  );
}

function MessageStep({ d, id, reload }: { d: Detail; id: string; reload: () => Promise<void> }) {
  const [params, setParams] = useState<Record<string, Param>>(() => {
    const p: Record<string, Param> = { ...(d.campaign.params ?? {}) };
    for (const v of d.variables) {
      if (p[v.key]) continue;
      const hint = `${v.name} ${v.label}`.toLowerCase();
      p[v.key] = v.kind === "text" && /name/.test(hint) ? { source: "first_name", fallback: "there" } : { source: "text", value: v.example ?? "" };
    }
    return p;
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const set = (k: string, patch: Partial<Param>) => setParams((p) => ({ ...p, [k]: { ...p[k], ...patch } as Param }));

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ params }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Could not save");
      toast.success(j.problems?.length ? "Saved — a few things still need filling in" : "Message ready");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }
  async function uploadImage(key: string, file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", "menu");
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Upload failed");
      set(key, { source: "text", value: `${window.location.origin}${j.files[0].url}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Step n={2} title="Message" sub="Choose what fills each blank in the template — the same for everyone, or from each person's details." done={d.variables.length === 0 || d.problems.length === 0}>
      {d.variables.length === 0 ? (
        <p className="text-xs text-muted-foreground">This template has nothing to fill in.</p>
      ) : (
        <div className="space-y-3">
          {d.variables.map((v) => {
            const p = params[v.key] ?? { source: "text" };
            return (
              <div key={v.key} className="rounded-xl border border-border p-2.5">
                <div className="text-xs font-medium text-foreground">{v.label}</div>
                {v.kind === "media" ? (
                  <div className="mt-1.5 flex gap-2">
                    <input value={p.value ?? ""} onChange={(e) => set(v.key, { source: "text", value: e.target.value })} placeholder="https://… (public image link)" className={field} />
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-xl border border-border px-3 text-xs hover:bg-muted">
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
                      <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && uploadImage(v.key, e.target.files[0])} />
                    </label>
                  </div>
                ) : (
                  <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                    <select
                      value={p.source === "column" ? `column:${p.value ?? ""}` : p.source}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val.startsWith("column:")) set(v.key, { source: "column", value: val.slice(7) });
                        else set(v.key, { source: val as Param["source"], value: val === "text" ? (p.source === "text" ? p.value : v.example) : undefined });
                      }}
                      className={field}
                    >
                      <option value="text">Same text for everyone</option>
                      <option value="first_name">Their first name</option>
                      <option value="name">Their full name</option>
                      <option value="phone">Their phone number</option>
                      {d.columns.map((col) => (
                        <option key={col} value={`column:${col}`}>
                          Sheet column: {col}
                        </option>
                      ))}
                    </select>
                    {p.source === "text" ? (
                      <input value={p.value ?? ""} onChange={(e) => set(v.key, { value: e.target.value })} maxLength={v.maxLength} placeholder={v.example ? `e.g. ${v.example}` : "Text"} className={field} />
                    ) : p.source !== "phone" ? (
                      <input value={p.fallback ?? ""} onChange={(e) => set(v.key, { fallback: e.target.value })} maxLength={200} placeholder="If missing, use… (e.g. there)" className={field} />
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save message
            </button>
          </div>
        </div>
      )}
      <div className="mt-4">
        <div className="mb-1.5 text-xs text-muted-foreground">Preview{d.previewFor ? ` for ${d.previewFor.name || `+${d.previewFor.phone}`}` : ""} (after saving)</div>
        <div className="rounded-2xl bg-[#efeae2] p-3">
          <TemplateBubble preview={d.preview} className="ml-auto" />
        </div>
      </div>
    </Step>
  );
}

function ReviewStep({ d, id, health, call, busy }: { d: Detail; id: string; health: Health; call: (k: string, url: string, init: RequestInit, done?: string) => Promise<unknown>; busy: string | null }) {
  const c = d.campaign;
  const limit = health?.limit ? LIMIT_NUM[health.limit] : undefined;
  const ready = d.problems.length === 0 && d.stats.total > 0 && c.optInConfirmed;
  return (
    <Step n={3} title="Review & send" sub="Check everything, confirm consent, then send." done={false}>
      <dl className="grid grid-cols-[8rem_1fr] gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Template</dt>
        <dd className="text-foreground">
          {c.templateName} ({c.templateCategory.toLowerCase()}, {c.templateLanguage})
        </dd>
        <dt className="text-muted-foreground">Recipients</dt>
        <dd className="font-medium text-foreground tabular-nums">{d.stats.total.toLocaleString("en-IN")}</dd>
        <dt className="text-muted-foreground">Variables</dt>
        <dd className="text-foreground">
          {d.variables.length === 0
            ? "None"
            : d.variables
                .map((v) => {
                  const p = c.params?.[v.key];
                  const how = !p ? "not set" : p.source === "text" ? `"${(p.value ?? "").slice(0, 30)}"` : p.source === "column" ? `column ${p.value}` : p.source.replace("_", " ");
                  return `${v.label}: ${how}`;
                })
                .join(" · ")}
        </dd>
      </dl>

      {d.problems.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-destructive/10 p-2.5 text-xs text-destructive">
          {d.problems.map((p) => (
            <li key={p} className="flex items-start gap-1.5">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p}
            </li>
          ))}
        </ul>
      )}
      {limit && d.stats.total > limit && (
        <p className="mt-3 rounded-xl bg-gold/15 p-2.5 text-xs text-foreground">
          Your WhatsApp number can start {limitText(health?.limit)} new conversations a day. People beyond that won&apos;t receive it today — consider splitting the list.
        </p>
      )}
      {c.templateCategory === "MARKETING" && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Marketing messages are charged by Meta per delivered message. WhatsApp may hold one back for someone who has had many offers recently (shown as failed with the reason).
        </p>
      )}

      <label className="mt-3 flex items-start gap-2 rounded-xl border border-border p-2.5 text-xs text-foreground">
        <input
          type="checkbox"
          checked={c.optInConfirmed}
          onChange={(e) => call("optin", `/api/admin/campaigns/${id}`, { method: "PATCH", body: JSON.stringify({ optInConfirmed: e.target.checked }) })}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          I confirm everyone on this list agreed to receive WhatsApp messages from Ela &amp; Co. (WhatsApp&apos;s rules — messaging people who didn&apos;t can get the number restricted). Anyone who replies STOP is removed automatically.
        </span>
      </label>

      <button
        onClick={() => confirm(`Send "${c.templateName}" to ${d.stats.total.toLocaleString("en-IN")} people now? This can't be undone.`) && call("send", `/api/admin/campaigns/${id}/send`, { method: "POST" }, "Sending started")}
        disabled={!ready || busy !== null}
        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1fb957] disabled:opacity-50"
      >
        {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send to {d.stats.total.toLocaleString("en-IN")} {d.stats.total === 1 ? "person" : "people"}
      </button>
    </Step>
  );
}

function LiveStats({ d, onResume, busy }: { d: Detail; onResume: () => void; busy: boolean }) {
  const s = d.stats;
  const tiles = [
    { label: "Recipients", value: s.total },
    { label: "Sent", value: s.sent },
    { label: "Delivered", value: s.delivered },
    { label: "Read", value: s.read },
    { label: "Failed", value: s.failed, bad: true },
    { label: s.pending ? "Waiting" : "Skipped", value: s.pending || s.skipped },
  ];
  const done = s.total ? Math.round(((s.total - s.pending) / s.total) * 100) : 100;
  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-4">
      {d.campaign.lastError && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <span className="inline-flex items-start gap-1.5">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Sending paused: {d.campaign.lastError}
          </span>
          <button onClick={onResume} disabled={busy} className="inline-flex items-center gap-1 rounded-full bg-destructive px-3 py-1 font-semibold text-destructive-foreground disabled:opacity-60">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Resume
          </button>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-muted/50 p-2.5">
            <div className={`font-serif text-xl tabular-nums ${t.bad && t.value ? "text-destructive" : "text-foreground"}`}>{t.value.toLocaleString("en-IN")}</div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.label}</div>
          </div>
        ))}
      </div>
      {d.campaign.status === "SENDING" && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-[#25D366] transition-all" style={{ width: `${done}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">{done}% processed · keep this page open to watch; sending continues on its own</div>
        </div>
      )}
    </div>
  );
}

function RecipientTable({
  d,
  filter,
  setFilter,
  q,
  setQ,
  page,
  setPage,
  onRemove,
}: {
  d: Detail;
  filter: string;
  setFilter: (f: string) => void;
  q: string;
  setQ: (v: string) => void;
  page: number;
  setPage: (n: number) => void;
  onRemove?: (id: string) => void;
}) {
  const draft = d.campaign.status === "DRAFT";
  const chips = draft
    ? []
    : [
        { k: "", label: "All" },
        { k: "PENDING", label: "Waiting" },
        { k: "SENT", label: "Sent" },
        { k: "DELIVERED", label: "Delivered" },
        { k: "READ", label: "Read" },
        { k: "FAILED", label: "Failed" },
        { k: "SKIPPED", label: "Skipped" },
      ];
  const pages = Math.max(1, Math.ceil(d.recipients.total / 50));
  return (
    <div className="rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{draft ? "Recipient list" : "Recipients"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button key={c.k} onClick={() => setFilter(c.k)} className={`rounded-full px-2.5 py-1 text-[11px] ${filter === c.k ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80"}`}>
              {c.label}
            </button>
          ))}
          <label className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or number" className="w-40 rounded-full border border-input bg-background py-1.5 pl-8 pr-3 text-base sm:text-xs" />
          </label>
        </div>
      </div>
      {d.recipients.items.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">{draft ? "Nobody added yet." : "Nobody here."}</p>
      ) : (
        <div className="divide-y divide-border/60">
          {d.recipients.items.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{r.name || "—"}</div>
                <div className="font-mono text-muted-foreground">+{r.phone}</div>
              </div>
              {!draft && (
                <div className="text-right">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${RSTATUS[r.status]}`}>{r.status === "PENDING" || r.status === "SENDING" ? "waiting" : r.status.toLowerCase()}</span>
                  <div className="mt-0.5 max-w-[16rem] truncate text-[11px] text-muted-foreground" title={r.error || undefined}>
                    {r.error || time(r.readAt ?? r.deliveredAt ?? r.sentAt)}
                  </div>
                </div>
              )}
              {draft && <span className="text-[10px] uppercase text-muted-foreground">{r.source === "crm" ? "customer" : "sheet"}</span>}
              {draft && onRemove && (
                <button onClick={() => onRemove(r.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Remove ${r.name || r.phone}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t border-border p-2 text-xs">
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} className="rounded-full px-3 py-1 hover:bg-muted disabled:opacity-40">
            Previous
          </button>
          <span className="text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <button onClick={() => setPage(Math.min(pages - 1, page + 1))} disabled={page >= pages - 1} className="rounded-full px-3 py-1 hover:bg-muted disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
