"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LifeBuoy, Plus, Send, Loader2, X, MessageSquare } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer, WhatsAppFab } from "@/components/site/Footer";
import { useAuth } from "@/lib/auth-client";
import { FileUpload, Attachments, type UploadedFile } from "@/components/site/FileUpload";

const CATEGORIES = [
  "Order Issue",
  "Payment Issue",
  "Delivery Issue",
  "Refund Request",
  "Subscription Issue",
  "Technical Issue",
  "Feedback",
  "Other",
];

type Msg = { id: string; authorType: string; authorLabel: string | null; body: string; attachments: string[]; createdAt: string };
type Ticket = {
  id: string;
  ticketNo: string;
  category: string;
  subject: string;
  status: "OPEN" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "RESOLVED" | "CLOSED";
  createdAt: string;
  orderId: string | null;
  messages: Msg[];
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  WAITING_CUSTOMER: "Waiting for you",
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

export default function SupportPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/tickets", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setTickets(d.tickets);
        setOpen((cur) => (cur ? d.tickets.find((t: Ticket) => t.id === cur.id) || cur : null));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== "customer") {
      router.replace("/login?next=/support");
      return;
    }
    load();
  }, [user, authLoading, router, load]);

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-gold">Support</div>
              <h1 className="mt-3 font-serif text-4xl sm:text-5xl text-foreground">Help &amp; complaints</h1>
              <p className="mt-2 text-muted-foreground">Raise an issue and track it here — no need to call.</p>
            </div>
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" /> Raise a complaint
            </button>
          </div>

          <div className="mt-10 space-y-4">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-28 rounded-2xl border border-border bg-card animate-pulse" />)
            ) : tickets.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
                <LifeBuoy className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">You haven&apos;t raised any complaints.</p>
              </div>
            ) : (
              tickets.map((t) => (
                <button key={t.id} onClick={() => setOpen(t)} className="w-full text-left rounded-2xl border border-border bg-card p-5 shadow-soft hover:border-gold/50 transition-colors">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-foreground">{t.subject}</div>
                      <div className="text-xs text-muted-foreground">{t.ticketNo} · {t.category} · {new Date(t.createdAt).toLocaleDateString("en-IN")}</div>
                    </div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLS[t.status]}`}>{STATUS_LABEL[t.status]}</span>
                  </div>
                  <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" /> {t.messages.length} message{t.messages.length > 1 ? "s" : ""}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </section>

      {creating && <NewTicket onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
      {open && <TicketThread ticket={open} onClose={() => setOpen(null)} onReplied={load} />}

      <Footer />
      <WhatsAppFab />
    </main>
  );
}

function NewTicket({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [orderId, setOrderId] = useState("");
  const [orders, setOrders] = useState<{ id: string; invoiceNo: string | null }[]>([]);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/orders", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setOrders((d.orders || []).map((o: { id: string; invoiceNo: string | null }) => ({ id: o.id, invoiceNo: o.invoiceNo }))))
      .catch(() => {});
  }, []);

  async function submit() {
    if (subject.trim().length < 3 || body.trim().length < 5) return toast.error("Add a subject and describe the issue");
    setSaving(true);
    try {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subject: subject.trim(),
          body: body.trim(),
          orderId: orderId || undefined,
          attachments: attachments.map((a) => a.url),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Could not submit");
      toast.success("Complaint registered — we'll be in touch");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div className="w-full max-w-lg rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl text-foreground">Raise a complaint</h2>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">Issue category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Related order (optional)</span>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm">
              <option value="">Not about a specific order</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.invoiceNo || `#${o.id.slice(-6).toUpperCase()}`}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Short summary" className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Describe the issue</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
          </label>
          <FileUpload files={attachments} onChange={setAttachments} disabled={saving} label="Attach photo or document (optional)" />
        </div>
        <div className="mt-6 flex gap-3">
          <button onClick={submit} disabled={saving} className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit
          </button>
          <button onClick={onClose} className="rounded-full border border-border px-6 py-3 text-sm hover:bg-muted">Cancel</button>
        </div>
      </div>
    </div>
  );
}

function TicketThread({ ticket, onClose, onReplied }: { ticket: Ticket; onClose: () => void; onReplied: () => void }) {
  const [reply, setReply] = useState("");
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [sending, setSending] = useState(false);
  const closed = ticket.status === "CLOSED";

  async function send() {
    if (!reply.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply.trim(), attachments: attachments.map((a) => a.url) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Could not send");
      setReply("");
      setAttachments([]);
      onReplied();
      toast.success("Reply sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-foreground">{ticket.subject}</h2>
            <div className="text-xs text-muted-foreground">{ticket.ticketNo} · {ticket.category}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-muted shrink-0"><X className="h-4 w-4" /></button>
        </div>

        <span className={`mt-3 self-start inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLS[ticket.status]}`}>{STATUS_LABEL[ticket.status]}</span>

        <div className="mt-4 flex-1 overflow-y-auto space-y-3">
          {ticket.messages.map((m) => (
            <div key={m.id} className={`rounded-2xl p-3 text-sm ${m.authorType === "customer" ? "bg-muted ml-6" : "bg-forest/5 border border-forest/20 mr-6"}`}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {m.authorType === "customer" ? "You" : "Ela & Co. Support"} · {new Date(m.createdAt).toLocaleString("en-IN")}
              </div>
              <div className="mt-1 text-foreground whitespace-pre-wrap">{m.body}</div>
              <Attachments urls={m.attachments} />
            </div>
          ))}
        </div>

        {closed ? (
          <div className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground text-center">This complaint is closed.</div>
        ) : (
          <div className="mt-4 space-y-2">
            <div className="flex gap-2">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
                placeholder="Write a reply…"
                className="flex-1 rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
              />
              <button onClick={send} disabled={sending || !reply.trim()} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
            <FileUpload files={attachments} onChange={setAttachments} disabled={sending} label="Attach" />
          </div>
        )}
      </div>
    </div>
  );
}
