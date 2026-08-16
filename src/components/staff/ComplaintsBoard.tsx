"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Search, Loader2, Send, X, LifeBuoy, Lock, Download, UserCog } from "lucide-react";
import { downloadCsv } from "@/lib/export";
import { ExportMenu } from "@/components/staff/ExportMenu";
import { FileUpload, Attachments, type UploadedFile } from "@/components/site/FileUpload";

const CATEGORIES = ["Order Issue", "Payment Issue", "Delivery Issue", "Refund Request", "Subscription Issue", "Technical Issue", "Feedback", "Other"];
const STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED", "CLOSED"] as const;

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  WAITING_CUSTOMER: "Waiting for customer",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};
const STATUS_CLS: Record<string, string> = {
  OPEN: "bg-gold/15 text-foreground",
  IN_PROGRESS: "bg-blue-500/10 text-blue-600",
  WAITING_CUSTOMER: "bg-gold/25 text-foreground",
  RESOLVED: "bg-forest/10 text-forest",
  CLOSED: "bg-muted text-muted-foreground",
};

type Msg = { id: string; authorType: string; authorLabel: string | null; body: string; attachments: string[]; internal: boolean; createdAt: string };
type Staff = { id: string; username: string; name: string | null; role: string };
type Ticket = {
  id: string;
  ticketNo: string;
  customerName: string;
  customerPhone: string;
  category: string;
  subject: string;
  status: string;
  createdAt: string;
  orderId: string | null;
  assignedToId: string | null;
  order: { id: string; invoiceNo: string | null; total: number } | null;
  messages: Msg[];
};

export function ComplaintsBoard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({ status: "", category: "", q: "" });
  const [open, setOpen] = useState<Ticket | null>(null);

  useEffect(() => {
    fetch("/api/staff", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { staff: [] }))
      .then((d) => setStaff(d.staff || d.users || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (f.status) p.set("status", f.status);
      if (f.category) p.set("category", f.category);
      if (f.q) p.set("q", f.q);
      const res = await fetch(`/api/tickets?${p.toString()}`, { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setTickets(d.tickets);
        setOpen((cur) => (cur ? d.tickets.find((t: Ticket) => t.id === cur.id) || null : null));
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
    if (!tickets.length) return toast.error("Nothing to export");
    downloadCsv(
      `complaints-${new Date().toISOString().slice(0, 10)}.csv`,
      tickets.map((t) => ({
        Ticket: t.ticketNo,
        Date: new Date(t.createdAt).toLocaleString("en-IN"),
        Customer: t.customerName,
        Phone: t.customerPhone,
        Category: t.category,
        Subject: t.subject,
        Order: t.order?.invoiceNo || t.orderId || "",
        Status: STATUS_LABEL[t.status] || t.status,
        Messages: t.messages.length,
      })),
    );
  }

  const openCount = tickets.filter((t) => ["OPEN", "IN_PROGRESS", "WAITING_CUSTOMER"].includes(t.status)).length;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Support</h1>
          <p className="text-sm text-muted-foreground">Customer complaints and support tickets. {openCount > 0 && <span className="text-gold font-medium">{openCount} needing attention.</span>}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted" title="Export exactly what the filters show">
            <Download className="h-4 w-4" /> Filtered CSV
          </button>
          <ExportMenu type="complaints" label="Export all" />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <label className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Ticket / name / phone / order" className="w-64 rounded-xl border border-input bg-background pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Status</span>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} className="mt-1 block rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
            <option value="">All</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-muted-foreground">Category</span>
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="mt-1 block rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {(f.status || f.category || f.q) && (
          <button onClick={() => setF({ status: "", category: "", q: "" })} className="rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted">Clear</button>
        )}
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-2">
        {loading && tickets.length === 0 ? (
          <div className="text-muted-foreground">Loading…</div>
        ) : tickets.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
            <LifeBuoy className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">No complaints match these filters.</p>
          </div>
        ) : (
          tickets.map((t) => (
            <button key={t.id} onClick={() => setOpen(t)} className="text-left rounded-2xl border border-border bg-card p-4 hover:border-gold/50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-foreground truncate">{t.subject}</div>
                  <div className="text-xs text-muted-foreground">{t.ticketNo} · {t.category}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{t.customerName} · {t.customerPhone}</div>
                </div>
                <span className={`shrink-0 inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                {new Date(t.createdAt).toLocaleString("en-IN")} · {t.messages.length} message{t.messages.length > 1 ? "s" : ""}
              </div>
            </button>
          ))
        )}
      </div>

      {open && <TicketDetail ticket={open} staff={staff} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function TicketDetail({ ticket, staff, onClose, onChanged }: { ticket: Ticket; staff: Staff[]; onClose: () => void; onChanged: () => void }) {
  const [reply, setReply] = useState("");
  const [internal, setInternal] = useState(false);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [sending, setSending] = useState(false);

  async function patch(payload: Record<string, unknown>) {
    const res = await fetch(`/api/tickets/${ticket.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error((await res.json()).error || "Failed");
  }

  async function send() {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await patch({ message: reply.trim(), internal, attachments: attachments.map((a) => a.url) });
      setReply("");
      setAttachments([]);
      onChanged();
      toast.success(internal ? "Internal note added" : "Reply sent to customer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: string) {
    try {
      await patch({ status });
      onChanged();
      toast.success(`Ticket → ${STATUS_LABEL[status]}`);
    } catch {
      toast.error("Could not update status");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="h-full w-full max-w-xl flex flex-col bg-card shadow-elegant" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-serif text-2xl text-foreground">{ticket.subject}</h2>
              <div className="text-sm text-muted-foreground">{ticket.ticketNo} · {ticket.category}</div>
              <div className="text-sm text-muted-foreground">
                {ticket.customerName} · <a href={`tel:${ticket.customerPhone}`} className="hover:text-foreground">{ticket.customerPhone}</a>
              </div>
              {ticket.order && (
                <Link href={`/orders/${ticket.order.id}/invoice`} target="_blank" className="mt-1 inline-block text-xs text-forest underline underline-offset-4">
                  Order {ticket.order.invoiceNo || ticket.order.id.slice(-6).toUpperCase()}
                </Link>
              )}
            </div>
            <button onClick={onClose} className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-muted shrink-0"><X className="h-4 w-4" /></button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-full px-3 py-1.5 text-xs transition-colors ${ticket.status === s ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80 hover:bg-secondary"}`}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <UserCog className="h-3.5 w-3.5" /> Assigned to
            <select
              value={ticket.assignedToId || ""}
              onChange={async (e) => {
                try {
                  await patch({ assignedToId: e.target.value || null });
                  onChanged();
                  toast.success(e.target.value ? "Ticket assigned" : "Assignment cleared");
                } catch {
                  toast.error("Could not assign");
                }
              }}
              className="rounded-lg border border-input bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="">Unassigned</option>
              {staff.map((st) => (
                <option key={st.id} value={st.id}>{st.name || st.username}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {ticket.messages.map((m) => (
            <div
              key={m.id}
              className={`rounded-2xl p-3 text-sm ${
                m.internal ? "bg-gold/10 border border-gold/40" : m.authorType === "customer" ? "bg-muted mr-6" : "bg-forest/5 border border-forest/20 ml-6"
              }`}
            >
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                {m.internal && <Lock className="h-3 w-3" />}
                {m.internal ? "Internal note" : m.authorType === "customer" ? m.authorLabel || "Customer" : `Support (${m.authorLabel || "staff"})`} · {new Date(m.createdAt).toLocaleString("en-IN")}
              </div>
              <div className="mt-1 text-foreground whitespace-pre-wrap">{m.body}</div>
              <Attachments urls={m.attachments} />
            </div>
          ))}
        </div>

        <div className="border-t border-border px-6 py-4">
          <label className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} className="h-3.5 w-3.5" />
            Internal note (not visible to the customer)
          </label>
          <div className="mb-2">
            <FileUpload files={attachments} onChange={setAttachments} disabled={sending} label="Attach" />
          </div>
          <div className="flex gap-2">
            <input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
              placeholder={internal ? "Add an internal note…" : "Reply to the customer…"}
              className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
            <button onClick={send} disabled={sending || !reply.trim()} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
