"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, RotateCw, Search, ChevronDown, AlertTriangle } from "lucide-react";
import { STATUS_LABEL, type OrderStatus } from "@/lib/order-status";

type Row = {
  id: string;
  orderId: string;
  customerName: string;
  phone: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  messageType: string | null;
  templateName: string | null;
  body: string;
  status: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
  deliveryStatus: string | null;
  error: string | null;
  attempts: number;
  response: unknown;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  order: { id: string; invoiceNo: string | null; status: OrderStatus };
};

const FILTERS = [
  { key: "", label: "All" },
  { key: "FAILED", label: "Failed" },
  { key: "SENT", label: "Sent" },
  { key: "SKIPPED", label: "Not sent" },
] as const;

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function StatusChip({ r }: { r: Row }) {
  if (r.status === "FAILED") return <span className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive">Failed</span>;
  if (r.status === "SKIPPED") return <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Not sent</span>;
  if (r.status === "PENDING") return <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Sending…</span>;
  const receipt = r.deliveryStatus === "read" ? "Read ✓✓" : r.deliveryStatus === "delivered" ? "Delivered ✓✓" : "Sent ✓";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.deliveryStatus === "read" ? "bg-blue-500/10 text-blue-700" : "bg-green-500/15 text-green-700"}`}>{receipt}</span>;
}

/** WhatsApp order-update log (spec #46): every automatic message, its outcome, and a retry for failures. */
export function NotificationLog() {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [failed24h, setFailed24h] = useState(0);
  const [filter, setFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    async (append = false) => {
      setLoading(true);
      try {
        const qs = new URLSearchParams({ limit: "50", offset: append ? String(rows.length) : "0" });
        if (filter) qs.set("status", filter);
        if (q.trim()) qs.set("q", q.trim());
        const res = await fetch(`/api/admin/notifications?${qs}`, { cache: "no-store" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Could not load");
        setRows((prev) => (append ? [...prev, ...d.notifications] : d.notifications));
        setTotal(d.total);
        setFailed24h(d.failed24h);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not load");
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter, q],
  );

  useEffect(() => {
    const t = setTimeout(() => load(false), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  async function retry(r: Row) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/admin/notifications/${r.id}/retry`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Retry failed");
      if (d.notification.status === "SENT") toast.success(`Sent to ${r.customerName}`);
      else toast.error(d.notification.error || "Still failing");
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, ...d.notification } : x)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">WhatsApp message log</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every automatic order update sent to customers, and what happened to it.</p>
        </div>
        <button onClick={() => load(false)} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {failed24h > 0 && (
        <button
          onClick={() => setFilter("FAILED")}
          className="mt-5 flex w-full items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-left text-sm text-foreground"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <span>
            <strong>{failed24h}</strong> update{failed24h > 1 ? "s" : ""} failed in the last 24 hours. The orders were not affected. Check the reason and retry, or
            contact the customer directly.
          </span>
        </button>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-4 py-1.5 text-sm ${filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80 hover:bg-secondary"}`}
          >
            {f.label}
          </button>
        ))}
        <label className="relative ml-auto block w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Customer, phone or order…"
            className="w-full rounded-full border border-input bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
          />
        </label>
      </div>

      <div className="mt-4 space-y-2">
        {loading && rows.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl border border-border bg-card" />)
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">No messages in this view.</div>
        ) : (
          rows.map((r) => (
            <div key={r.id} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-serif text-lg text-foreground">#{r.orderId.slice(-6).toUpperCase()}</span>
                    {r.order.invoiceNo && <span className="text-xs text-muted-foreground">{r.order.invoiceNo}</span>}
                    <StatusChip r={r} />
                  </div>
                  <div className="mt-0.5 text-sm text-foreground">
                    {r.customerName} <span className="text-muted-foreground">· +{r.phone}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.fromStatus ? `${STATUS_LABEL[r.fromStatus]} → ` : "New order → "}
                    <strong className="font-medium text-foreground">{STATUS_LABEL[r.toStatus]}</strong> · {when(r.createdAt)}
                    {r.messageType && ` · ${r.messageType === "template" ? `template ${r.templateName}` : "text"}`}
                    {r.attempts > 1 && ` · ${r.attempts} attempts`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {(r.status === "FAILED" || r.status === "SKIPPED") && (
                    <button
                      onClick={() => retry(r)}
                      disabled={busy === r.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      <RotateCw className={`h-3.5 w-3.5 ${busy === r.id ? "animate-spin" : ""}`} /> Retry
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(open === r.id ? null : r.id)}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    aria-expanded={open === r.id}
                  >
                    Details <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === r.id ? "rotate-180" : ""}`} />
                  </button>
                </div>
              </div>

              {r.error && <div className="mt-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">{r.error}</div>}

              {open === r.id && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Message</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-xl bg-[#dcf8c6] px-3 py-2 text-[13px] text-[#111b21]">{r.body}</div>
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {r.sentAt && <>Sent {when(r.sentAt)}. </>}
                      {r.deliveredAt && <>Delivered {when(r.deliveredAt)}. </>}
                      {r.readAt && <>Read {when(r.readAt)}.</>}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">WhatsApp response</div>
                    <pre className="mt-1 max-h-56 overflow-auto rounded-xl bg-charcoal p-3 text-[11px] leading-relaxed text-ivory/90">
                      {r.response ? JSON.stringify(r.response, null, 2) : "—"}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {rows.length < total && (
        <div className="mt-4 text-center">
          <button onClick={() => load(true)} className="rounded-full border border-border px-5 py-2 text-sm hover:bg-muted">
            Load more ({total - rows.length})
          </button>
        </div>
      )}
    </div>
  );
}
