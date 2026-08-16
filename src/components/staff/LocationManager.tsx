"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, X, Save, Loader2, MapPin } from "lucide-react";
import { inr } from "@/lib/utils";

type Location = {
  id: string;
  name: string;
  area: string | null;
  deliveryFee: number;
  active: boolean;
  sortOrder: number;
};

type Draft = {
  id?: string;
  name: string;
  area: string;
  deliveryFee: number;
  active: boolean;
  sortOrder: number;
};

const BLANK: Draft = { name: "", area: "", deliveryFee: 40, active: true, sortOrder: 0 };

export function LocationManager() {
  const [items, setItems] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/locations?all=1", { cache: "no-store" });
      if (res.ok) setItems((await res.json()).locations);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Location name is required");
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        area: draft.area.trim() || null,
        deliveryFee: Number(draft.deliveryFee) || 0,
        active: draft.active,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      const res = draft.id
        ? await fetch(`/api/locations/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      toast.success(draft.id ? "Location updated" : "Location added");
      setDraft(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(loc: Location) {
    setItems((prev) => prev.map((i) => (i.id === loc.id ? { ...i, active: !i.active } : i)));
    await fetch(`/api/locations/${loc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !loc.active }),
    }).catch(() => load());
  }

  async function del(loc: Location) {
    if (!confirm(`Delete "${loc.name}"? Customers will no longer be able to select it.`)) return;
    setItems((prev) => prev.filter((i) => i.id !== loc.id));
    const res = await fetch(`/api/locations/${loc.id}`, { method: "DELETE" });
    if (res.ok) toast.success("Location deleted");
    else {
      toast.error("Could not delete");
      load();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Delivery locations</h1>
          <p className="text-sm text-muted-foreground">The areas you deliver to. Customers pick one at checkout; inactive areas are hidden.</p>
        </div>
        <button
          onClick={() => setDraft({ ...BLANK, sortOrder: items.length + 1 })}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add location
        </button>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground">No delivery areas yet. Add your first one.</div>
        ) : (
          items.map((m) => (
            <div key={m.id} className={`rounded-2xl border bg-card p-4 ${m.active ? "border-border" : "border-dashed border-border opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-forest shrink-0" />
                    <span className="font-serif text-lg text-foreground truncate">{m.name}</span>
                  </div>
                  {m.area && <div className="mt-0.5 text-xs text-muted-foreground">{m.area}</div>}
                </div>
                <div className="text-right shrink-0 text-sm">
                  <div className="text-muted-foreground text-xs">Delivery</div>
                  <div className="font-medium text-foreground">{m.deliveryFee > 0 ? inr(m.deliveryFee) : "Free"}</div>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => toggle(m)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                  {m.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {m.active ? "Active" : "Inactive"}
                </button>
                <button
                  onClick={() => setDraft({ id: m.id, name: m.name, area: m.area ?? "", deliveryFee: m.deliveryFee, active: m.active, sortOrder: m.sortOrder })}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button onClick={() => del(m)} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-md rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl text-foreground">{draft.id ? "Edit location" : "New location"}</h2>
              <button onClick={() => setDraft(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <Field label="Area name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Pattom" />
              <Field label="Description (optional)" value={draft.area} onChange={(v) => setDraft({ ...draft, area: v })} placeholder="Near Medical College" />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Delivery fee (₹)" type="number" value={String(draft.deliveryFee)} onChange={(v) => setDraft({ ...draft, deliveryFee: Number(v) })} />
                <Field label="Sort order" type="number" value={String(draft.sortOrder)} onChange={(v) => setDraft({ ...draft, sortOrder: Number(v) })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4" />
                Active (customers can select this area)
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

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
      />
    </label>
  );
}
