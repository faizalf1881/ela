"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Eye, EyeOff, X, Save, Loader2, Crown, AlertTriangle, Download, Users } from "lucide-react";
import { inr } from "@/lib/utils";
import { downloadCsv } from "@/lib/export";

type Plan = {
  id: string;
  name: string;
  description: string;
  price: number;
  interval: "WEEKLY" | "MONTHLY" | "YEARLY";
  intervalCount: number;
  discountPercent: number;
  freeDelivery: boolean;
  benefits: string[];
  active: boolean;
  sortOrder: number;
  razorpayPlanId: string | null;
};

type Sub = {
  id: string;
  status: string;
  currentEnd: string | null;
  startedAt: string | null;
  createdAt: string;
  plan: { name: string; price: number };
  customer?: { id: string; name: string | null; phone: string } | null;
  charges: { id: string; amount: number; paidAt: string }[];
};

type Draft = {
  id?: string;
  name: string;
  description: string;
  price: string;
  interval: "WEEKLY" | "MONTHLY" | "YEARLY";
  intervalCount: string;
  discountPercent: string;
  freeDelivery: boolean;
  benefits: string;
  active: boolean;
  sortOrder: string;
};

const BLANK: Draft = {
  name: "",
  description: "",
  price: "499",
  interval: "MONTHLY",
  intervalCount: "1",
  discountPercent: "10",
  freeDelivery: true,
  benefits: "",
  active: true,
  sortOrder: "0",
};

const STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-forest/10 text-forest",
  CREATED: "bg-gold/15 text-foreground",
  PAUSED: "bg-blue-500/10 text-blue-600",
  CANCELLED: "bg-muted text-muted-foreground",
  EXPIRED: "bg-muted text-muted-foreground",
};

export function PlanManager() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        fetch("/api/plans?all=1", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/subscriptions", { cache: "no-store" }).then((r) => r.json()),
      ]);
      setPlans(p.plans || []);
      setSubs(s.subscriptions || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    if (!draft) return;
    if (!draft.name.trim()) return toast.error("Plan name is required");
    if (!Number(draft.price)) return toast.error("Enter a price");
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        price: Number(draft.price),
        interval: draft.interval,
        intervalCount: Number(draft.intervalCount) || 1,
        discountPercent: Number(draft.discountPercent) || 0,
        freeDelivery: draft.freeDelivery,
        benefits: draft.benefits.split("\n").map((b) => b.trim()).filter(Boolean),
        active: draft.active,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      const res = draft.id
        ? await fetch(`/api/plans/${draft.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      toast.success(draft.id ? "Plan updated" : "Plan created");
      if (data.warning) toast.warning(data.warning, { duration: 10000 });
      setDraft(null);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(p: Plan) {
    setPlans((prev) => prev.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)));
    await fetch(`/api/plans/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !p.active }) }).catch(() => load());
  }

  async function del(p: Plan) {
    if (!confirm(`Delete plan "${p.name}"?`)) return;
    const res = await fetch(`/api/plans/${p.id}`, { method: "DELETE" });
    const data = await res.json();
    if (res.ok) toast.success(data.message || "Plan deleted");
    else toast.error(data.error || "Could not delete");
    load();
  }

  function exportSubs() {
    if (!subs.length) return toast.error("Nothing to export");
    downloadCsv(
      `subscriptions-${new Date().toISOString().slice(0, 10)}.csv`,
      subs.map((s) => ({
        Customer: s.customer?.name || "",
        Phone: s.customer?.phone || "",
        Plan: s.plan.name,
        Amount: s.plan.price,
        Status: s.status,
        Started: s.startedAt ? new Date(s.startedAt).toLocaleDateString("en-IN") : "",
        Renews: s.currentEnd ? new Date(s.currentEnd).toLocaleDateString("en-IN") : "",
        "Payments received": s.charges.length,
      })),
    );
  }

  const activeSubs = subs.filter((s) => s.status === "ACTIVE");
  const mrr = activeSubs.reduce((n, s) => n + s.plan.price, 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Memberships</h1>
          <p className="text-sm text-muted-foreground">Subscription plans and subscribers. Billing runs on Razorpay AutoPay (eMandate).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportSubs} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted">
            <Download className="h-4 w-4" /> Export
          </button>
          <button onClick={() => setDraft({ ...BLANK, sortOrder: String(plans.length + 1) })} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> New plan
          </button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Active members" value={String(activeSubs.length)} />
        <Stat label="Recurring revenue" value={inr(mrr)} />
        <Stat label="Plans" value={String(plans.length)} />
      </div>

      {/* Plans */}
      <h2 className="mt-10 font-serif text-2xl text-foreground">Plans</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : plans.length === 0 ? (
          <div className="text-muted-foreground">No plans yet. Create your first membership plan.</div>
        ) : (
          plans.map((p) => (
            <div key={p.id} className={`rounded-2xl border bg-card p-4 ${p.active ? "border-border" : "border-dashed border-border opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Crown className="h-4 w-4 text-gold shrink-0" />
                    <span className="font-serif text-lg text-foreground truncate">{p.name}</span>
                  </div>
                  <div className="mt-1 text-sm text-foreground">
                    {inr(p.price)} / {p.intervalCount > 1 ? `${p.intervalCount} ` : ""}{p.interval.toLowerCase().replace("ly", "")}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {p.discountPercent > 0 ? `${p.discountPercent}% off orders` : "No order discount"}{p.freeDelivery ? " · Free delivery" : ""}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {subs.filter((s) => s.status === "ACTIVE" && s.plan.name === p.name).length} active member(s)
                  </div>
                </div>
              </div>

              {!p.razorpayPlanId && (
                <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  Not linked to Razorpay — customers can&apos;t subscribe. Enable Subscriptions on your Razorpay account, then save this plan again.
                </div>
              )}

              <div className="mt-4 flex items-center gap-2">
                <button onClick={() => toggle(p)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                  {p.active ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {p.active ? "Live" : "Hidden"}
                </button>
                <button
                  onClick={() =>
                    setDraft({
                      id: p.id,
                      name: p.name,
                      description: p.description,
                      price: String(p.price),
                      interval: p.interval,
                      intervalCount: String(p.intervalCount),
                      discountPercent: String(p.discountPercent),
                      freeDelivery: p.freeDelivery,
                      benefits: p.benefits.join("\n"),
                      active: p.active,
                      sortOrder: String(p.sortOrder),
                    })
                  }
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button onClick={() => del(p)} className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Subscribers */}
      <h2 className="mt-10 font-serif text-2xl text-foreground">Subscribers</h2>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Plan</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Renews</th>
              <th className="px-4 py-3">Payments</th>
            </tr>
          </thead>
          <tbody>
            {subs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  <Users className="h-6 w-6 mx-auto mb-2" /> No subscribers yet.
                </td>
              </tr>
            ) : (
              subs.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <div className="text-foreground">{s.customer?.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{s.customer?.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{s.plan.name} <span className="text-muted-foreground">({inr(s.plan.price)})</span></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[s.status] || "bg-muted"}`}>{s.status}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{s.currentEnd ? new Date(s.currentEnd).toLocaleDateString("en-IN") : "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.charges.length}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => !saving && setDraft(null)}>
          <div className="w-full max-w-lg rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl text-foreground">{draft.id ? "Edit plan" : "New plan"}</h2>
              <button onClick={() => setDraft(null)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 space-y-3">
              <Field label="Plan name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Ela Gold" />
              <Field label="Short description" value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} placeholder="For families who order weekly" />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Price (₹)" type="number" value={draft.price} onChange={(v) => setDraft({ ...draft, price: v })} />
                <label className="block">
                  <span className="text-xs text-muted-foreground">Billing</span>
                  <select value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: e.target.value as Draft["interval"] })} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                </label>
                <Field label="Every N cycles" type="number" value={draft.intervalCount} onChange={(v) => setDraft({ ...draft, intervalCount: v })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Order discount %" type="number" value={draft.discountPercent} onChange={(v) => setDraft({ ...draft, discountPercent: v })} />
                <Field label="Sort order" type="number" value={draft.sortOrder} onChange={(v) => setDraft({ ...draft, sortOrder: v })} />
              </div>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={draft.freeDelivery} onChange={(e) => setDraft({ ...draft, freeDelivery: e.target.checked })} className="h-4 w-4" />
                Free delivery on every order
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Extra benefits (one per line)</span>
                <textarea value={draft.benefits} onChange={(e) => setDraft({ ...draft, benefits: e.target.value })} rows={4} placeholder={"Priority kitchen slot\nEarly access to festival menus"} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="h-4 w-4" />
                Live (customers can subscribe)
              </label>
              {draft.id && (
                <p className="text-[11px] text-muted-foreground">
                  Changing price or billing cycle creates a new Razorpay plan. Existing members keep their current rate until they resubscribe.
                </p>
              )}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-serif text-2xl text-foreground">{value}</div>
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
