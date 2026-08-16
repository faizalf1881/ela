"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, X, Save, Loader2, Download, FileText, Trash2, Search } from "lucide-react";
import { inr } from "@/lib/utils";
import { downloadCsv } from "@/lib/export";

type Invoice = {
  id: string;
  invoiceNo: string;
  createdAt: string;
  customerName: string;
  customerPhone: string;
  total: number;
  paymentMethod: string;
  paymentStatus: "PAID" | "UNPAID" | "FAILED";
  paymentType: string;
  items: string;
  itemCount: number;
};

type Summary = { count: number; total: number; paid: number };
type Line = { name: string; price: string; qty: string };

const METHOD_LABEL: Record<string, string> = { razorpay: "Online", cod: "Cash on Delivery", manual: "Manual" };
const STATUS_LABEL: Record<string, string> = { PAID: "Paid", UNPAID: "Pending", FAILED: "Failed" };
const STATUS_CLS: Record<string, string> = {
  PAID: "bg-forest/10 text-forest",
  UNPAID: "bg-amber-100 text-amber-700",
  FAILED: "bg-destructive/10 text-destructive",
};

export function AccountsBoard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [summary, setSummary] = useState<Summary>({ count: 0, total: 0, paid: 0 });
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ status: "", method: "", q: "", from: "", to: "" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (f.status) params.set("status", f.status);
      if (f.method) params.set("method", f.method);
      if (f.q) params.set("q", f.q);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      const res = await fetch(`/api/admin/accounts?${params.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setInvoices(d.invoices);
        setSummary(d.summary);
      }
    } finally {
      setLoading(false);
    }
  }, [f]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  function exportCsv() {
    if (!invoices.length) return toast.error("Nothing to export");
    downloadCsv(
      `invoices-${new Date().toISOString().slice(0, 10)}.csv`,
      invoices.map((i) => ({
        Invoice: i.invoiceNo,
        Date: new Date(i.createdAt).toLocaleString("en-IN"),
        Customer: i.customerName,
        Phone: i.customerPhone,
        Items: i.items,
        Amount: i.total,
        Method: METHOD_LABEL[i.paymentMethod] || i.paymentMethod,
        Type: i.paymentType,
        Status: STATUS_LABEL[i.paymentStatus] || i.paymentStatus,
      })),
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Accounts</h1>
          <p className="text-sm text-muted-foreground">Every invoice generated across the platform. Filter, export, or create a manual invoice.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted">
            <Download className="h-4 w-4" /> Export CSV
          </button>
          <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" /> New invoice
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Invoices" value={String(summary.count)} />
        <Stat label="Total billed" value={inr(summary.total)} />
        <Stat label="Collected (paid)" value={inr(summary.paid)} />
      </div>

      {/* Filters */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={f.q}
            onChange={(e) => setF({ ...f, q: e.target.value })}
            placeholder="Invoice / name / phone"
            className="w-56 rounded-xl border border-input bg-background pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
          />
        </label>
        <Select label="Status" value={f.status} onChange={(v) => setF({ ...f, status: v })} options={[["", "All"], ["PAID", "Paid"], ["UNPAID", "Pending"], ["FAILED", "Failed"]]} />
        <Select label="Method" value={f.method} onChange={(v) => setF({ ...f, method: v })} options={[["", "All"], ["razorpay", "Online"], ["cod", "Cash on Delivery"], ["manual", "Manual"]]} />
        <DateField label="From" value={f.from} onChange={(v) => setF({ ...f, from: v })} />
        <DateField label="To" value={f.to} onChange={(v) => setF({ ...f, to: v })} />
        {(f.status || f.method || f.q || f.from || f.to) && (
          <button onClick={() => setF({ status: "", method: "", q: "", from: "", to: "" })} className="rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted">
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Customer</th>
              <th className="px-4 py-3">Amount</th>
              <th className="px-4 py-3">Method</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && invoices.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">Loading…</td></tr>
            ) : invoices.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">No invoices match these filters.</td></tr>
            ) : (
              invoices.map((i) => (
                <tr key={i.id} className="border-t border-border">
                  <td className="px-4 py-3 font-medium text-foreground">{i.invoiceNo}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{new Date(i.createdAt).toLocaleDateString("en-IN")}</td>
                  <td className="px-4 py-3">
                    <div className="text-foreground">{i.customerName}</div>
                    <div className="text-xs text-muted-foreground">{i.customerPhone}</div>
                  </td>
                  <td className="px-4 py-3 font-medium text-foreground whitespace-nowrap">{inr(i.total)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{METHOD_LABEL[i.paymentMethod] || i.paymentMethod}</td>
                  <td className="px-4 py-3 text-muted-foreground">{i.paymentType}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[i.paymentStatus]}`}>{STATUS_LABEL[i.paymentStatus]}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/orders/${i.id}/invoice`} target="_blank" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted">
                      <FileText className="h-3.5 w-3.5" /> View
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {creating && <CreateInvoice onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </div>
  );
}

function CreateInvoice({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [paid, setPaid] = useState(true);
  const [lines, setLines] = useState<Line[]>([{ name: "", price: "", qty: "1" }]);
  const [saving, setSaving] = useState(false);

  const total = lines.reduce((n, l) => n + (Number(l.price) || 0) * (Number(l.qty) || 0), 0);

  async function save() {
    if (!name.trim() || !phone.trim()) return toast.error("Enter customer name and phone");
    const items = lines
      .filter((l) => l.name.trim() && Number(l.price) > 0 && Number(l.qty) > 0)
      .map((l) => ({ name: l.name.trim(), price: Number(l.price), qty: Number(l.qty) }));
    if (items.length === 0) return toast.error("Add at least one line item");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerName: name.trim(), customerPhone: phone.trim(), items, paid }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      toast.success("Invoice created");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-lg rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl text-foreground">New invoice</h2>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Input label="Customer name" value={name} onChange={setName} />
          <Input label="Phone" value={phone} onChange={setPhone} />
        </div>
        <div className="mt-4">
          <div className="text-xs text-muted-foreground mb-1">Line items</div>
          <div className="space-y-2">
            {lines.map((l, idx) => (
              <div key={idx} className="flex gap-2">
                <input value={l.name} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))} placeholder="Item" className="flex-1 rounded-xl border border-input bg-background px-3 py-2 text-sm" />
                <input value={l.price} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, price: e.target.value } : x)))} placeholder="₹" type="number" className="w-20 rounded-xl border border-input bg-background px-3 py-2 text-sm" />
                <input value={l.qty} onChange={(e) => setLines(lines.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))} placeholder="Qty" type="number" className="w-16 rounded-xl border border-input bg-background px-3 py-2 text-sm" />
                <button onClick={() => setLines(lines.length > 1 ? lines.filter((_, i) => i !== idx) : lines)} className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
          <button onClick={() => setLines([...lines, { name: "", price: "", qty: "1" }])} className="mt-2 inline-flex items-center gap-1.5 text-sm text-forest hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} className="h-4 w-4" /> Marked as paid
          </label>
          <div className="font-serif text-xl text-foreground">{inr(total)}</div>
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={save} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Create invoice
          </button>
          <button onClick={onClose} className="rounded-full border border-border px-6 py-3 text-sm hover:bg-muted">Cancel</button>
        </div>
      </div>
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

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60">
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 block rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
    </label>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
    </label>
  );
}
