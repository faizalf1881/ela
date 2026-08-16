"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, X, Save, Loader2, Upload, Image as ImageIcon } from "lucide-react";
import { inr } from "@/lib/utils";
import { effectivePrice } from "@/lib/pricing";

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  discountPercent: number;
  category: string;
  tag: string | null;
  spice: number;
  imageUrl: string | null;
  available: boolean;
  stock: number | null;
  sortOrder: number;
};

type Draft = {
  id?: string;
  name: string;
  description: string;
  price: number;
  discountPercent: number;
  category: string;
  tag: string;
  spice: number;
  imageUrl: string;
  available: boolean;
  stock: string; // "" = unlimited
  sortOrder: number;
};

const BLANK: Draft = {
  name: "",
  description: "",
  price: 249,
  discountPercent: 0,
  category: "Meals",
  tag: "",
  spice: 1,
  imageUrl: "",
  available: true,
  stock: "",
  sortOrder: 0,
};

export function MenuManager() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/menu?all=1", { cache: "no-store" });
      if (res.ok) setItems((await res.json()).items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim() || !draft.price) return toast.error("Name and price are required");
    setSaving(true);
    try {
      const payload = {
        name: draft.name,
        description: draft.description,
        price: Number(draft.price),
        discountPercent: Number(draft.discountPercent) || 0,
        category: draft.category || "Meals",
        tag: draft.tag || null,
        spice: Number(draft.spice),
        imageUrl: draft.imageUrl || null,
        available: draft.available,
        stock: draft.stock.trim() === "" ? null : Number(draft.stock),
        sortOrder: Number(draft.sortOrder) || 0,
      };
      const res = draft.id
        ? await fetch(`/api/menu/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      toast.success(draft.id ? "Item updated" : "Item added");
      setDraft(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: MenuItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, available: !i.available } : i)));
    await fetch(`/api/menu/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ available: !item.available }),
    }).catch(() => load());
  }

  async function del(item: MenuItem) {
    if (!confirm(`Delete "${item.name}"? This cannot be undone.`)) return;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    const res = await fetch(`/api/menu/${item.id}`, { method: "DELETE" });
    if (res.ok) toast.success("Item deleted");
    else {
      toast.error("Could not delete");
      load();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Menu</h1>
          <p className="text-sm text-muted-foreground">Set prices, discounts and daily stock. Hidden items don&apos;t show to customers.</p>
        </div>
        <button
          onClick={() => setDraft({ ...BLANK, sortOrder: items.length + 1 })}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add item
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground">No menu items yet. Add your first dish.</div>
        ) : (
          items.map((m) => {
            const eff = effectivePrice(m.price, m.discountPercent);
            const soldOut = m.stock !== null && m.stock <= 0;
            return (
              <div key={m.id} className={`rounded-2xl border bg-card overflow-hidden ${m.available ? "border-border" : "border-dashed border-border opacity-70"}`}>
                <div className="relative aspect-[16/10] bg-muted overflow-hidden">
                  <Image src={m.imageUrl || "/menu/traditional.jpg"} alt={m.name} fill sizes="(max-width:1280px) 50vw, 400px" className="object-cover" />
                  {m.discountPercent > 0 && (
                    <span className="absolute top-2 left-2 rounded-full bg-gold px-2 py-0.5 text-[11px] font-semibold text-charcoal">{m.discountPercent}% OFF</span>
                  )}
                  {soldOut && (
                    <span className="absolute top-2 right-2 rounded-full bg-destructive px-2 py-0.5 text-[11px] font-semibold text-destructive-foreground">Sold out</span>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-serif text-lg text-foreground truncate">{m.name}</div>
                      <div className="text-xs text-muted-foreground">{m.category}{m.tag ? ` · ${m.tag}` : ""}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-serif text-lg text-foreground">{inr(eff)}</div>
                      {m.discountPercent > 0 && <div className="text-xs text-muted-foreground line-through">{inr(m.price)}</div>}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">Stock: {m.stock === null ? "Unlimited" : m.stock}</div>
                  <div className="mt-4 flex items-center gap-2">
                    <button onClick={() => toggle(m)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted" title="Toggle visibility">
                      {m.available ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                      {m.available ? "Visible" : "Hidden"}
                    </button>
                    <button
                      onClick={() =>
                        setDraft({
                          ...m,
                          tag: m.tag ?? "",
                          imageUrl: m.imageUrl ?? "",
                          stock: m.stock === null ? "" : String(m.stock),
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button onClick={() => del(m)} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-lg rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl text-foreground">{draft.id ? "Edit item" : "New item"}</h2>
              <button onClick={() => setDraft(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <Input label="Name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
              <Input label="Description" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} textarea />
              <div className="grid grid-cols-3 gap-3">
                <Input label="Price (₹)" type="number" value={String(draft.price)} onChange={(v) => setDraft({ ...draft, price: Number(v) })} />
                <Input label="Discount %" type="number" value={String(draft.discountPercent)} onChange={(v) => setDraft({ ...draft, discountPercent: Number(v) })} />
                <Input label="Stock" type="number" value={draft.stock} onChange={(v) => setDraft({ ...draft, stock: v })} placeholder="∞" />
              </div>
              {draft.discountPercent > 0 && (
                <div className="text-xs text-forest">
                  Customer pays <strong>{inr(effectivePrice(Number(draft.price) || 0, Number(draft.discountPercent) || 0))}</strong>{" "}
                  <span className="line-through text-muted-foreground">{inr(Number(draft.price) || 0)}</span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Input label="Category" value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} />
                <Input label="Tag (optional)" value={draft.tag} onChange={(v) => setDraft({ ...draft, tag: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">Spice (0–3)</span>
                  <select value={draft.spice} onChange={(e) => setDraft({ ...draft, spice: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
                    {[0, 1, 2, 3].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <Input label="Sort order" type="number" value={String(draft.sortOrder)} onChange={(v) => setDraft({ ...draft, sortOrder: Number(v) })} />
              </div>
              <ImageField value={draft.imageUrl} onChange={(v) => setDraft({ ...draft, imageUrl: v })} />
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={draft.available} onChange={(e) => setDraft({ ...draft, available: e.target.checked })} className="h-4 w-4" />
                Visible to customers
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

/** Dish photo: upload straight from the device, or paste a link. */
function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [uploading, setUploading] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", "menu");
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      onChange(data.files[0].url);
      toast.success("Photo uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <span className="text-xs text-muted-foreground">Dish photo</span>
      <div className="mt-1 flex items-center gap-3">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-border">
          {value ? (
            <Image src={value} alt="Dish" fill sizes="64px" className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
            </div>
          )}
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Upload photo"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(f);
                  e.target.value = "";
                }}
              />
            </label>
            {value && (
              <button type="button" onClick={() => onChange("")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                <X className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="…or paste an image link"
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-gold/60"
          />
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">JPG, PNG, WEBP or GIF · up to 2 MB</p>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  textarea,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  textarea?: boolean;
  placeholder?: string;
}) {
  const cls = "mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60";
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      {textarea ? (
        <textarea rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      ) : (
        <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
      )}
    </label>
  );
}
