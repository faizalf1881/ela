"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, X, Save, Loader2, Star, Link2, Check } from "lucide-react";

type Review = {
  id: string;
  authorName: string;
  location: string | null;
  rating: number;
  body: string;
  published: boolean;
  source: string;
  sortOrder: number;
};

type Draft = {
  id?: string;
  authorName: string;
  location: string;
  rating: number;
  body: string;
  published: boolean;
  sortOrder: number;
};

const BLANK: Draft = { authorName: "", location: "", rating: 5, body: "", published: true, sortOrder: 0 };

export function ReviewManager() {
  const [items, setItems] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reviews?all=1", { cache: "no-store" });
      if (res.ok) setItems((await res.json()).reviews);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function copyLink() {
    const url = `${window.location.origin}/review`;
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        toast.success("Review link copied");
        setTimeout(() => setCopied(false), 2000);
      },
      () => toast.error("Could not copy"),
    );
  }

  async function save() {
    if (!draft) return;
    if (!draft.authorName.trim() || !draft.body.trim()) return toast.error("Name and review text are required");
    setSaving(true);
    try {
      const payload = {
        authorName: draft.authorName.trim(),
        location: draft.location.trim() || null,
        rating: draft.rating,
        body: draft.body.trim(),
        published: draft.published,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      const res = draft.id
        ? await fetch(`/api/reviews/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      toast.success(draft.id ? "Review updated" : "Review added");
      setDraft(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish(r: Review) {
    setItems((prev) => prev.map((i) => (i.id === r.id ? { ...i, published: !i.published } : i)));
    await fetch(`/api/reviews/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ published: !r.published }) }).catch(() => load());
  }

  async function del(r: Review) {
    if (!confirm(`Delete review by ${r.authorName}?`)) return;
    setItems((prev) => prev.filter((i) => i.id !== r.id));
    const res = await fetch(`/api/reviews/${r.id}`, { method: "DELETE" });
    if (res.ok) toast.success("Review deleted");
    else {
      toast.error("Could not delete");
      load();
    }
  }

  const pending = items.filter((r) => !r.published);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Reviews</h1>
          <p className="text-sm text-muted-foreground">Control which testimonials show on the website. Share the collection link to gather new ones.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={copyLink} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted">
            {copied ? <Check className="h-4 w-4 text-forest" /> : <Link2 className="h-4 w-4" />} Review link
          </button>
          <button onClick={() => setDraft({ ...BLANK, sortOrder: items.length + 1 })} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> Add review
          </button>
        </div>
      </div>

      {pending.length > 0 && (
        <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/5 p-4">
          <div className="text-sm font-medium text-foreground">{pending.length} review{pending.length > 1 ? "s" : ""} awaiting moderation</div>
          <p className="text-xs text-muted-foreground">Submitted through your review link. Publish the ones you want to show.</p>
        </div>
      )}

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground">No reviews yet. Add one or share your review link.</div>
        ) : (
          items.map((r) => (
            <div key={r.id} className={`rounded-2xl border bg-card p-4 ${r.published ? "border-border" : "border-dashed border-gold/50"}`}>
              <div className="flex items-center justify-between">
                <div className="flex gap-0.5">
                  {Array.from({ length: Math.max(1, Math.min(5, r.rating)) }).map((_, i) => (
                    <Star key={i} className="h-3.5 w-3.5 fill-gold text-gold" />
                  ))}
                </div>
                {!r.published && <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-medium text-foreground uppercase tracking-wide">Pending</span>}
              </div>
              <blockquote className="mt-2 text-sm text-foreground italic">&ldquo;{r.body}&rdquo;</blockquote>
              <div className="mt-3 text-xs text-muted-foreground">
                {r.authorName}{r.location ? ` · ${r.location}` : ""}{r.source === "collected" ? " · submitted" : ""}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => togglePublish(r)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                  {r.published ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {r.published ? "Published" : "Publish"}
                </button>
                <button
                  onClick={() => setDraft({ id: r.id, authorName: r.authorName, location: r.location ?? "", rating: r.rating, body: r.body, published: r.published, sortOrder: r.sortOrder })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button onClick={() => del(r)} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-lg rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl text-foreground">{draft.id ? "Edit review" : "New review"}</h2>
              <button onClick={() => setDraft(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Author name" value={draft.authorName} onChange={(v) => setDraft({ ...draft, authorName: v })} />
                <Field label="Location" value={draft.location} onChange={(v) => setDraft({ ...draft, location: v })} placeholder="Trivandrum" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">Rating</span>
                  <select value={draft.rating} onChange={(e) => setDraft({ ...draft, rating: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
                    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? "s" : ""}</option>)}
                  </select>
                </label>
                <Field label="Sort order" type="number" value={String(draft.sortOrder)} onChange={(v) => setDraft({ ...draft, sortOrder: Number(v) })} />
              </div>
              <label className="block">
                <span className="text-xs text-muted-foreground">Review</span>
                <textarea value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} rows={3} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={draft.published} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} className="h-4 w-4" />
                Published (visible on the website)
              </label>
            </div>
            <div className="mt-6 flex gap-3">
              <button onClick={save} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </button>
              <button onClick={() => setDraft(null)} className="rounded-full border border-border px-6 py-3 text-sm hover:bg-muted">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
    </label>
  );
}
