"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Search, Download, X, Save, Loader2, Phone, MapPin, Calendar, ShoppingBag, Wallet, Crown } from "lucide-react";
import { inr } from "@/lib/utils";
import { downloadCsv } from "@/lib/export";
import { STATUS_LABEL, type OrderStatus } from "@/lib/order-status";

type OrderLite = {
  id: string;
  invoiceNo: string | null;
  createdAt: string;
  total: number;
  paymentMethod: string;
  paymentStatus: "PAID" | "UNPAID" | "FAILED";
  status: OrderStatus;
};

type Customer = {
  id: string;
  name: string | null;
  phone: string;
  address: string | null;
  notes: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  totalOrders: number;
  currentOrders: number;
  totalSpent: number;
  lastOrderAt: string | null;
  preferredMethod: string;
  orders: OrderLite[];
  subscriptionStatus: string;
  planName: string | null;
  planPrice: number | null;
  planInterval: string | null;
  renewsAt: string | null;
  subscriptionPaid: number;
  subscriptionPayments: { id: string; amount: number; paidAt: string }[];
};

const METHOD_LABEL: Record<string, string> = { razorpay: "Online", cod: "Cash", manual: "Manual" };
const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN") : "—");
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-IN") : "—");

export function CrmBoard() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/crm?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      if (res.ok) setCustomers((await res.json()).customers);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  function exportCsv() {
    if (!customers.length) return toast.error("Nothing to export");
    downloadCsv(
      `customers-${new Date().toISOString().slice(0, 10)}.csv`,
      customers.map((c) => ({
        Name: c.name || "",
        Phone: c.phone,
        Address: c.address || "",
        Registered: fmtDate(c.createdAt),
        "Total orders": c.totalOrders,
        "Total spent": c.totalSpent,
        "Preferred payment": METHOD_LABEL[c.preferredMethod] || c.preferredMethod,
        "Last order": fmtDate(c.lastOrderAt),
        "Last login": fmt(c.lastLoginAt),
        Membership: c.subscriptionStatus === "ACTIVE" ? c.planName || "Active" : c.subscriptionStatus,
        "Renewal date": fmtDate(c.renewsAt),
        "Membership paid": c.subscriptionPaid,
      })),
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground">Every customer, their order history and lifetime value. Click a row for the full profile.</p>
        </div>
        <div className="flex gap-2">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" className="w-56 rounded-full border border-input bg-background pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
          </label>
          <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted">
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Orders</th>
              <th className="px-4 py-3">Spent</th>
              <th className="px-4 py-3">Preferred</th>
              <th className="px-4 py-3">Last order</th>
              <th className="px-4 py-3">Registered</th>
            </tr>
          </thead>
          <tbody>
            {loading && customers.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No customers yet.</td></tr>
            ) : (
              customers.map((c) => (
                <tr key={c.id} onClick={() => setSelected(c)} className="border-t border-border cursor-pointer hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <div className="text-foreground font-medium">{c.name || "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-foreground">{c.totalOrders}{c.currentOrders > 0 && <span className="ml-1 text-xs text-gold">({c.currentOrders} active)</span>}</td>
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{inr(c.totalSpent)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{METHOD_LABEL[c.preferredMethod] || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(c.lastOrderAt)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(c.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && <CustomerDetail customer={selected} onClose={() => setSelected(null)} onSaved={(c) => { setSelected(c); load(); }} />}
    </div>
  );
}

function CustomerDetail({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const [notes, setNotes] = useState(customer.notes || "");
  const [address, setAddress] = useState(customer.address || "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/crm/${customer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes || null, address: address || null }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success("Saved");
      onSaved({ ...customer, notes: notes || null, address: address || null });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-xl overflow-y-auto bg-card shadow-elegant" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 flex items-center justify-between border-b border-border bg-card px-6 py-4">
          <div>
            <h2 className="font-serif text-2xl text-foreground">{customer.name || "Customer"}</h2>
            <div className="text-sm text-muted-foreground">{customer.phone}</div>
          </div>
          <button onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Metric icon={ShoppingBag} label="Orders" value={String(customer.totalOrders)} />
            <Metric icon={Wallet} label="Spent" value={inr(customer.totalSpent)} />
            <Metric icon={Calendar} label="Registered" value={fmtDate(customer.createdAt)} />
          </div>

          <div className="grid grid-cols-1 gap-2 text-sm">
            <Info icon={Phone} label="Mobile" value={customer.phone} />
            <Info icon={MapPin} label="Address" value={customer.address || "—"} />
            <Info icon={Calendar} label="Last login / activity" value={fmt(customer.lastLoginAt)} />
            <Info icon={Wallet} label="Preferred payment" value={METHOD_LABEL[customer.preferredMethod] || "—"} />
            <Info
              icon={Crown}
              label="Subscription"
              value={
                customer.subscriptionStatus === "ACTIVE"
                  ? `${customer.planName} — ${inr(customer.planPrice || 0)}/${(customer.planInterval || "").toLowerCase().replace("ly", "")}`
                  : customer.subscriptionStatus === "NONE"
                    ? "No membership"
                    : `${customer.planName ?? "—"} (${customer.subscriptionStatus.toLowerCase()})`
              }
            />
            {customer.renewsAt && <Info icon={Calendar} label="Renewal date" value={fmtDate(customer.renewsAt)} />}
            {customer.subscriptionPaid > 0 && <Info icon={Wallet} label="Membership paid" value={inr(customer.subscriptionPaid)} />}
          </div>

          {customer.subscriptionPayments.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Membership payments</div>
              <div className="space-y-1.5">
                {customer.subscriptionPayments.map((p) => (
                  <div key={p.id} className="flex justify-between rounded-xl border border-border px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{fmtDate(p.paidAt)}</span>
                    <span className="text-foreground">{inr(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Editable */}
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Address</span>
              <input value={address} onChange={(e) => setAddress(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">Internal notes (admin only)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
            </label>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </button>
          </div>

          {/* Order & payment history */}
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Order &amp; payment history</div>
            {customer.orders.length === 0 ? (
              <div className="text-sm text-muted-foreground">No orders yet.</div>
            ) : (
              <div className="space-y-2">
                {customer.orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
                    <div>
                      <div className="text-foreground">{o.invoiceNo || `#${o.id.slice(-6).toUpperCase()}`}</div>
                      <div className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString("en-IN")} · {STATUS_LABEL[o.status]}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium text-foreground">{inr(o.total)}</div>
                      <div className="text-xs text-muted-foreground">{METHOD_LABEL[o.paymentMethod] || o.paymentMethod} · {o.paymentStatus === "PAID" ? "Paid" : o.paymentStatus === "FAILED" ? "Failed" : "Pending"}</div>
                    </div>
                    {o.invoiceNo && (
                      <Link href={`/orders/${o.id}/invoice`} target="_blank" className="rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted whitespace-nowrap">Invoice</Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-background p-3 text-center">
      <Icon className="h-4 w-4 mx-auto text-forest" />
      <div className="mt-1 font-serif text-lg text-foreground">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function Info({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-muted-foreground w-40 shrink-0">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
