"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, X, Save, Loader2, TicketPercent } from "lucide-react";
import { inr } from "@/lib/utils";

type Coupon = {
  id: string;
  code: string;
  discountType: "PERCENT" | "FIXED";
  value: number;
  minOrder: number | null;
  maxDiscount: number | null;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

type Draft = {
  id?: string;
  code: string;
  discountType: "PERCENT" | "FIXED";
  value: string;
  minOrder: string;
  maxDiscount: string;
  usageLimit: string;
  active: boolean;
  startsAt: string;
  endsAt: string;
};

const BLANK: Draft = {
  code: "",
  discountType: "PERCENT",
  value: "10",
  minOrder: "",
  maxDiscount: "",
  usageLimit: "",
  active: true,
  startsAt: "",
  endsAt: "",
};

const toDateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

export function CouponManager() {
  const [items, setItems] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/coupons", { cache: "no-store" });
      if (res.ok) setItems((await res.json()).coupons);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!draft) return;
    if (!draft.id && draft.code.trim().length < 2) return toast.error("Enter a coupon code");
    if (!draft.value || Number(draft.value) < 1) return toast.error("Enter a discount value");
    setSaving(true);
    try {
      const common = {
        discountType: draft.discountType,
        value: Number(draft.value),
        minOrder: numOrNull(draft.minOrder),
        maxDiscount: draft.discountType === "PERCENT" ? numOrNull(draft.maxDiscount) : null,
        usageLimit: numOrNull(draft.usageLimit),
        active: draft.active,
        startsAt: draft.startsAt || null,
        endsAt: draft.endsAt || null,
      };
      const res = draft.id
        ? await fetch(`/api/coupons/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(common) })
        : await fetch("/api/coupons", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...common, code: draft.code.trim().toUpperCase() }) });
      if (!res.ok) throw new Error((await res.json()).error || "Save failed");
      toast.success(draft.id ? "Coupon updated" : "Coupon created");
      setDraft(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(c: Coupon) {
    setItems((prev) => prev.map((i) => (i.id === c.id ? { ...i, active: !i.active } : i)));
    await fetch(`/api/coupons/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    }).catch(() => load());
  }

  async function del(c: Coupon) {
    if (!confirm(`Delete coupon ${c.code}?`)) return;
    setItems((prev) => prev.filter((i) => i.id !== c.id));
    const res = await fetch(`/api/coupons/${c.id}`, { method: "DELETE" });
    if (res.ok) toast.success("Coupon deleted");
    else {
      toast.error("Could not delete");
      load();
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Coupons</h1>
          <p className="text-sm text-muted-foreground">Discount codes customers can apply at checkout. Toggle off to pause without deleting.</p>
        </div>
        <button
          onClick={() => setDraft({ ...BLANK })}
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Create coupon
        </button>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-muted-foreground">No coupons yet. Create your first one.</div>
        ) : (
          items.map((c) => {
            const usedUp = c.usageLimit !== null && c.usedCount >= c.usageLimit;
            return (
              <div key={c.id} className={`rounded-2xl border bg-card p-4 ${c.active && !usedUp ? "border-border" : "border-dashed border-border opacity-70"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <TicketPercent className="h-4 w-4 text-gold shrink-0" />
                      <span className="font-mono font-semibold text-foreground truncate">{c.code}</span>
                    </div>
                    <div className="mt-1 text-sm text-foreground">
                      {c.discountType === "PERCENT" ? `${c.value}% off` : `${inr(c.value)} off`}
                      {c.maxDiscount !== null && c.discountType === "PERCENT" ? ` (max ${inr(c.maxDiscount)})` : ""}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {c.minOrder !== null ? `Min order ${inr(c.minOrder)} · ` : ""}
                      Used {c.usedCount}{c.usageLimit !== null ? ` / ${c.usageLimit}` : ""}
                    </div>
                    {(c.startsAt || c.endsAt) && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {c.startsAt ? new Date(c.startsAt).toLocaleDateString("en-IN") : "…"} – {c.endsAt ? new Date(c.endsAt).toLocaleDateString("en-IN") : "…"}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <button onClick={() => toggle(c)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                    {c.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {c.active ? "Enabled" : "Disabled"}
                  </button>
                  <button
                    onClick={() =>
                      setDraft({
                        id: c.id,
                        code: c.code,
                        discountType: c.discountType,
                        value: String(c.value),
                        minOrder: c.minOrder !== null ? String(c.minOrder) : "",
                        maxDiscount: c.maxDiscount !== null ? String(c.maxDiscount) : "",
                        usageLimit: c.usageLimit !== null ? String(c.usageLimit) : "",
                        active: c.active,
                        startsAt: toDateInput(c.startsAt),
                        endsAt: toDateInput(c.endsAt),
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </button>
                  <button onClick={() => del(c)} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
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
              <h2 className="font-serif text-2xl text-foreground">{draft.id ? "Edit coupon" : "New coupon"}</h2>
              <button onClick={() => setDraft(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {draft.id ? (
                <div className="rounded-xl bg-muted px-3 py-2 text-sm">
                  Code: <span className="font-mono font-semibold">{draft.code}</span>
                </div>
              ) : (
                <Field label="Coupon code" value={draft.code} onChange={(v) => setDraft({ ...draft, code: v.toUpperCase() })} placeholder="WELCOME10" mono />
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-xs text-muted-foreground">Discount type</span>
                  <select value={draft.discountType} onChange={(e) => setDraft({ ...draft, discountType: e.target.value as "PERCENT" | "FIXED" })} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
                    <option value="PERCENT">Percentage</option>
                    <option value="FIXED">Fixed ₹</option>
                  </select>
                </label>
                <Field label={draft.discountType === "PERCENT" ? "Percent (%)" : "Amount (₹)"} type="number" value={draft.value} onChange={(v) => setDraft({ ...draft, value: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Min order ₹ (optional)" type="number" value={draft.minOrder} onChange={(v) => setDraft({ ...draft, minOrder: v })} placeholder="No minimum" />
                {draft.discountType === "PERCENT" ? (
                  <Field label="Max discount ₹ (optional)" type="number" value={draft.maxDiscount} onChange={(v) => setDraft({ ...draft, maxDiscount: v })} placeholder="No cap" />
                ) : (
                  <div />
                )}
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Usage limit" type="number" value={draft.usageLimit} onChange={(v) => setDraft({ ...draft, usageLimit: v })} placeholder="∞" />
                <Field label="Starts" type="date" value={draft.startsAt} onChange={(v) => setDraft({ ...draft, startsAt: v })} />
                <Field label="Ends" type="date" value={draft.endsAt} onChange={(v) => setDraft({ ...draft, endsAt: v })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4" />
                Enabled
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
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60 ${mono ? "font-mono" : ""}`}
      />
    </label>
  );
}
