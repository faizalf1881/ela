"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { X, Search, Loader2, RefreshCw, Send, Image as ImageIcon, ExternalLink, Phone, Copy, Reply, ArrowLeft, Upload } from "lucide-react";
import { renderPreview, type TemplatePreview, type TplVar } from "@/lib/wa-template-utils";

export type TemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  parameterFormat: string;
  components: unknown;
  source: string;
  variables: TplVar[];
  unsupported: string | null;
  sendable: boolean;
};

const CATEGORY_PILL: Record<string, string> = {
  MARKETING: "bg-gold/20 text-[oklch(0.45_0.12_75)]",
  UTILITY: "bg-blue-500/10 text-blue-700",
  AUTHENTICATION: "bg-muted text-muted-foreground",
};

export function CategoryPill({ category }: { category: string }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${CATEGORY_PILL[category] ?? "bg-muted text-muted-foreground"}`}>{category.toLowerCase()}</span>;
}

/** Loads the templates staff can send, with a one-tap sync from Meta. */
export function useSendableTemplates() {
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [canSync, setCanSync] = useState(false);
  const [syncing, setSyncing] = useState(false);
  async function load() {
    const res = await fetch("/api/admin/whatsapp/templates?sendable=1", { cache: "no-store" });
    const d = await res.json().catch(() => ({}));
    setTemplates(d.templates ?? []);
    setCanSync(!!d.canSync);
  }
  async function sync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/admin/whatsapp/templates/sync", { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not sync");
      toast.success(`${d.approved} approved template${d.approved === 1 ? "" : "s"} ready`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not sync");
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return { templates, canSync, syncing, sync, reload: load };
}

/** WhatsApp-style bubble of a template with its values filled in. */
export function TemplateBubble({ preview, className = "" }: { preview: TemplatePreview; className?: string }) {
  return (
    <div className={`max-w-sm rounded-2xl rounded-tr-sm bg-[#d9fdd3] text-sm text-[#111b21] shadow-soft ${className}`}>
      {preview.header?.kind === "media" &&
        (preview.header.url && preview.header.mediaType === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.header.url} alt="" className="h-36 w-full rounded-t-2xl object-cover" />
        ) : (
          <div className="flex h-24 items-center justify-center gap-1.5 rounded-t-2xl bg-black/5 text-xs text-black/50">
            <ImageIcon className="h-4 w-4" /> {preview.header.mediaType}
          </div>
        ))}
      <div className="px-3 py-2">
        {preview.header?.kind === "text" && <div className="mb-1 font-semibold">{preview.header.text}</div>}
        <div className="whitespace-pre-wrap break-words">{preview.body}</div>
        {preview.footer && <div className="mt-1 text-[11px] text-black/50">{preview.footer}</div>}
      </div>
      {preview.buttons.length > 0 && (
        <div className="divide-y divide-black/5 border-t border-black/5">
          {preview.buttons.map((b, i) => (
            <div key={i} className="flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] font-medium text-[#008069]">
              {b.type === "URL" ? <ExternalLink className="h-3.5 w-3.5" /> : b.type === "PHONE_NUMBER" ? <Phone className="h-3.5 w-3.5" /> : b.type === "COPY_CODE" ? <Copy className="h-3.5 w-3.5" /> : <Reply className="h-3.5 w-3.5" />}
              {b.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Fill-in fields for a template's variables (header text/media, body, button link ending, coupon). */
export function VariableFields({ template, values, onChange }: { template: TemplateRow; values: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const [uploading, setUploading] = useState(false);
  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", "menu");
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed");
      onChange({ ...values, header_media: `${window.location.origin}${d.files[0].url}` });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }
  if (template.variables.length === 0) return <p className="text-xs text-muted-foreground">This template has nothing to fill in.</p>;
  return (
    <div className="space-y-2.5">
      {template.variables.map((v) => (
        <label key={v.key} className="block">
          <span className="text-xs text-muted-foreground">{v.label}</span>
          <div className="mt-1 flex gap-2">
            <input
              value={values[v.key] ?? ""}
              onChange={(e) => onChange({ ...values, [v.key]: e.target.value })}
              maxLength={v.maxLength}
              placeholder={v.example ? `e.g. ${v.example}` : v.kind === "media" ? "https://…" : ""}
              className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gold/60 sm:text-sm"
            />
            {v.kind === "media" && v.mediaType === "image" && (
              <label className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-xl border border-border px-3 text-xs hover:bg-muted">
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
                <input type="file" accept="image/jpeg,image/png" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}

/**
 * "Quick reply": pick an approved template → fill in its variables → preview
 * → send (spec #2). `before` adds fields above the list (the phone number for
 * a new chat); `prefill` suggests values, e.g. the customer's first name.
 */
export function TemplateDialog({
  title,
  subtitle,
  prefill = {},
  before,
  canSend = true,
  onSend,
  onClose,
}: {
  title: string;
  subtitle?: string;
  prefill?: Record<string, string>;
  before?: ReactNode;
  canSend?: boolean;
  onSend: (template: TemplateRow, values: Record<string, string>) => Promise<void>;
  onClose: () => void;
}) {
  const { templates, canSync, syncing, sync } = useSendableTemplates();
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<TemplateRow | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => (templates ?? []).filter((t) => !q.trim() || `${t.name} ${JSON.stringify(t.components)}`.toLowerCase().includes(q.trim().toLowerCase())), [templates, q]);
  const preview = chosen ? renderPreview(chosen, values) : null;
  const missing = chosen ? chosen.variables.filter((v) => !values[v.key]?.trim()) : [];

  function choose(t: TemplateRow) {
    setChosen(t);
    // Suggest the customer's name for name-like variables.
    const v: Record<string, string> = {};
    for (const x of t.variables) {
      const hint = `${x.name} ${x.label}`.toLowerCase();
      if (prefill.name && x.kind === "text" && /name/.test(hint)) v[x.key] = prefill.name;
    }
    setValues(v);
  }

  async function send() {
    if (!chosen) return;
    if (missing.length) return toast.error(`Fill in: ${missing.map((m) => m.label).join(", ")}`);
    setBusy(true);
    try {
      await onSend(chosen, values);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-label={title} className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-card shadow-elegant ring-1 ring-border sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {chosen && (
                <button onClick={() => setChosen(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted" aria-label="Back to templates">
                  <ArrowLeft className="h-4 w-4" />
                </button>
              )}
              <h2 className="font-serif text-xl text-foreground">{chosen ? chosen.name : title}</h2>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{chosen ? "Fill in the details, check the preview, then send." : subtitle || "Only templates WhatsApp has approved can be sent."}</p>
          </div>
          <button onClick={onClose} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-muted" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {before}
          {!chosen ? (
            templates === null ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
                ))}
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <label className="relative block flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search templates…" className="w-full rounded-full border border-input bg-background py-2 pl-9 pr-3 text-base focus:outline-none focus:ring-2 focus:ring-gold/60 sm:text-sm" />
                  </label>
                  {canSync && (
                    <button onClick={sync} disabled={syncing} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs hover:bg-muted disabled:opacity-60" title="Fetch the latest approved templates from Meta">
                      <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} /> Sync
                    </button>
                  )}
                </div>
                {list.length === 0 ? (
                  <div className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    {templates.length === 0 ? (
                      <>
                        No approved templates yet. {canSync ? "Tap Sync to fetch them from Meta." : "Add WHATSAPP_BUSINESS_ACCOUNT_ID to sync them, or add one by hand in Bulk WhatsApp → Templates."}
                        <div className="mt-3">
                          <a href="/admin/campaigns?tab=templates" className="font-medium text-forest hover:underline">
                            Manage templates →
                          </a>
                        </div>
                      </>
                    ) : (
                      "No template matches your search."
                    )}
                  </div>
                ) : (
                  <div className="mt-3 space-y-2">
                    {list.map((t) => (
                      <button key={t.id} onClick={() => choose(t)} className="block w-full rounded-xl border border-border p-3 text-left hover:border-forest/40 hover:bg-muted/50">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{t.name}</span>
                          <CategoryPill category={t.category} />
                          <span className="text-[11px] text-muted-foreground">{t.language}</span>
                          {t.variables.length > 0 && <span className="text-[11px] text-muted-foreground">· {t.variables.length} to fill in</span>}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{renderPreview(t, {}).body}</div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )
          ) : (
            <div className="grid gap-5 sm:grid-cols-2">
              <VariableFields template={chosen} values={values} onChange={setValues} />
              <div>
                <div className="mb-2 text-xs text-muted-foreground">Preview</div>
                <div className="rounded-2xl bg-[#efeae2] p-3">{preview && <TemplateBubble preview={preview} className="ml-auto" />}</div>
                {chosen.category === "MARKETING" && <p className="mt-2 text-[11px] text-muted-foreground">Marketing template: WhatsApp charges per message and may hold it back for people who get many offers.</p>}
              </div>
            </div>
          )}
        </div>

        {chosen && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button onClick={() => setChosen(null)} className="rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
              Back
            </button>
            <button
              onClick={send}
              disabled={busy || !canSend}
              className="inline-flex items-center gap-2 rounded-full bg-[#25D366] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1fb957] disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send template
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
