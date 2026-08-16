"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  RefreshCw,
  Phone,
  MapPin,
  StickyNote,
  Clock,
  Volume2,
  VolumeX,
  ChevronRight,
  Check,
  CheckCircle2,
  Printer,
  FileText,
  ScanLine,
  Download,
} from "lucide-react";
import { inr } from "@/lib/utils";
import { downloadCsv } from "@/lib/export";
import { ExportMenu } from "@/components/staff/ExportMenu";
import {
  KITCHEN_STATUSES,
  STATUS_BADGE,
  STATUS_LABEL,
  type OrderDTO,
  type OrderStatus,
} from "@/lib/order-status";

const FILTERS: { key: string; label: string; match: (o: OrderDTO) => boolean }[] = [
  { key: "active", label: "Active", match: (o) => !["DELIVERED", "CANCELLED", "PENDING"].includes(o.status) },
  { key: "PLACED", label: "New", match: (o) => o.status === "PLACED" },
  { key: "PREPARING", label: "Preparing", match: (o) => o.status === "PREPARING" },
  { key: "OUT_FOR_DELIVERY", label: "On the way", match: (o) => o.status === "OUT_FOR_DELIVERY" },
  { key: "DELIVERED", label: "Delivered", match: (o) => o.status === "DELIVERED" },
  { key: "all", label: "All", match: () => true },
];

// Next step in the fulfillment flow + the button label for it.
const ADVANCE: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  PENDING: { next: "PLACED", label: "Confirm order" },
  PLACED: { next: "PREPARING", label: "Start preparing" },
  PREPARING: { next: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  OUT_FOR_DELIVERY: { next: "DELIVERED", label: "Mark delivered" },
};

function minutesSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

export function OrdersBoard({ showStats = false }: { showStats?: boolean }) {
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");
  const [saving, setSaving] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [, setTick] = useState(0); // forces elapsed-time re-render
  const [scan, setScan] = useState("");
  const [scanned, setScanned] = useState<string | null>(null); // highlighted order id

  const seenRef = useRef<Set<string> | null>(null);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const audioRef = useRef<AudioContext | null>(null);

  const beep = useCallback(() => {
    if (mutedRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current = audioRef.current || new Ctx();
      const ctx = audioRef.current;
      const play = (freq: number, start: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + 0.26);
      };
      play(880, 0);
      play(1174, 0.18);
    } catch {}
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      const next: OrderDTO[] = data.orders;

      // New-order detection (skip on first load).
      const activeIds = next.filter((o) => o.status === "PLACED").map((o) => o.id);
      if (seenRef.current === null) {
        seenRef.current = new Set(activeIds);
      } else {
        const fresh = activeIds.filter((id) => !seenRef.current!.has(id));
        if (fresh.length > 0) {
          beep();
          toast.success(`${fresh.length} new order${fresh.length > 1 ? "s" : ""}!`, { duration: 6000 });
        }
        for (const id of activeIds) seenRef.current!.add(id);
      }
      setOrders(next);
    } finally {
      setLoading(false);
    }
  }, [beep]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 10_000);
    const tick = setInterval(() => setTick((t) => t + 1), 20_000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function setStatus(id: string, status: OrderStatus) {
    setSaving(id);
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      const res = await fetch(`/api/orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Order → ${STATUS_LABEL[status]}`);
    } catch {
      toast.error("Could not update status");
      load();
    } finally {
      setSaving(null);
    }
  }

  /** Scanner types the QR contents then presses Enter — look the order up and jump to it. */
  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const code = scan.trim();
    if (!code) return;
    setScan("");
    try {
      const res = await fetch("/api/orders/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Not found");
      await load();
      setFilter("all");
      setScanned(data.order.id);
      toast.success(`Order #${data.order.id.slice(-6).toUpperCase()} — ${data.order.customerName}`);
      setTimeout(() => {
        document.getElementById(`order-${data.order.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No order matches that code");
    }
  }

  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) || FILTERS[0];
    return orders.filter(f.match);
  }, [orders, filter]);

  function exportCsv() {
    if (!visible.length) return toast.error("Nothing to export");
    downloadCsv(
      `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      visible.map((o) => ({
        Order: `#${o.id.slice(-6).toUpperCase()}`,
        Invoice: o.invoiceNo || "",
        Date: new Date(o.createdAt).toLocaleString("en-IN"),
        Customer: o.customerName,
        Phone: o.customerPhone,
        Address: o.address,
        Items: o.items.map((i) => `${i.name} x${i.qty}`).join("; "),
        Subtotal: o.subtotal,
        Delivery: o.deliveryFee,
        Total: o.total,
        Payment: o.paymentMethod,
        Paid: o.paymentStatus,
        Status: STATUS_LABEL[o.status],
      })),
    );
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const f of FILTERS) c[f.key] = orders.filter(f.match).length;
    return c;
  }, [orders]);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todays = orders.filter((o) => new Date(o.createdAt) >= today && !["PENDING", "CANCELLED"].includes(o.status));
    return {
      revenue: todays.reduce((n, o) => n + o.total, 0),
      count: todays.length,
      active: orders.filter((o) => !["DELIVERED", "CANCELLED", "PENDING"].includes(o.status)).length,
    };
  }, [orders]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-3xl text-foreground">Orders</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-forest/10 px-2.5 py-1 text-xs text-forest">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-forest opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-forest" />
            </span>
            Live
          </span>
        </div>
        <div className="flex items-center gap-2">
          <form onSubmit={handleScan}>
            <label className="relative block">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Scan label QR…"
                className="w-44 rounded-full border border-input bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
                title="Scan a delivery-label QR code (or type an order/invoice number) and press Enter"
              />
            </label>
          </form>
          <button onClick={() => setMuted((m) => !m)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-muted" title={muted ? "Unmute alerts" : "Mute alerts"}>
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted" title="Export the orders currently in view">
            <Download className="h-4 w-4" /> <span className="hidden sm:inline">View CSV</span>
          </button>
          {showStats && <ExportMenu type="orders" label="Export all" />}
          <button onClick={load} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </div>

      {showStats && (
        <div className="mt-5 grid grid-cols-3 gap-3">
          <MiniStat label="Today's revenue" value={inr(stats.revenue)} accent />
          <MiniStat label="Today's orders" value={String(stats.count)} />
          <MiniStat label="Active now" value={String(stats.active)} />
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors ${
              filter === f.key ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80 hover:bg-secondary"
            }`}
          >
            {f.label}
            <span className={`text-xs ${filter === f.key ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {loading && orders.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-64 rounded-2xl border border-border bg-card animate-pulse" />)
        ) : visible.length === 0 ? (
          <div className="text-muted-foreground">No orders in this view.</div>
        ) : (
          visible.map((o) => {
            const advance = ADVANCE[o.status];
            const done = o.status === "DELIVERED";
            const mins = minutesSince(o.createdAt);
            const active = !["DELIVERED", "CANCELLED"].includes(o.status);
            const urgency = !active ? "text-muted-foreground bg-muted" : mins >= 20 ? "text-destructive bg-destructive/10" : mins >= 10 ? "text-[oklch(0.55_0.12_75)] bg-gold/15" : "text-forest bg-forest/10";

            return (
              <div
                key={o.id}
                id={`order-${o.id}`}
                className={`flex flex-col rounded-2xl border bg-card p-5 shadow-soft transition-shadow ${
                  scanned === o.id ? "border-gold ring-2 ring-gold/60" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-serif text-lg text-foreground">#{o.id.slice(-6).toUpperCase()}</div>
                    <div className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${urgency}`}>
                      <Clock className="h-3 w-3" /> {mins === 0 ? "just now" : `${mins} min ago`}
                    </div>
                  </div>
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                </div>

                <div className="mt-4 space-y-1 text-sm">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex justify-between text-foreground/90">
                      <span className="font-medium">{it.qty}× {it.name}</span>
                      <span className="text-muted-foreground">{inr(it.price * it.qty)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 border-t border-border pt-3 space-y-1.5 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">{o.customerName}</div>
                  <a href={`tel:${o.customerPhone}`} className="flex items-center gap-2 hover:text-foreground">
                    <Phone className="h-3.5 w-3.5" /> {o.customerPhone}
                  </a>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" /> <span>{o.address}</span>
                  </div>
                  {o.notes && (
                    <div className="flex items-start gap-2 text-foreground">
                      <StickyNote className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gold" /> <span>{o.notes}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-serif text-base text-foreground">{inr(o.total)}</span>
                    <span className={`text-xs ${o.paymentStatus === "PAID" ? "text-green-600" : "text-muted-foreground"}`}>
                      {o.paymentMethod === "cod" ? "COD" : o.paymentStatus === "PAID" ? "Paid online" : "Unpaid"}
                    </span>
                  </div>
                </div>

                {/* Primary one-tap action + override */}
                <div className="mt-4 flex items-center gap-2">
                  {done ? (
                    <div className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-green-500/10 px-4 py-2.5 text-sm font-medium text-green-700">
                      <CheckCircle2 className="h-4 w-4" /> Delivered
                    </div>
                  ) : advance ? (
                    <button
                      onClick={() => setStatus(o.id, advance.next)}
                      disabled={saving === o.id}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                    >
                      {advance.next === "DELIVERED" ? <Check className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      {advance.label}
                    </button>
                  ) : null}
                  <select
                    value={KITCHEN_STATUSES.includes(o.status) ? o.status : "PLACED"}
                    disabled={saving === o.id}
                    onChange={(e) => setStatus(o.id, e.target.value as OrderStatus)}
                    className="rounded-full border border-input bg-background px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-gold/60"
                    title="Override status"
                  >
                    {KITCHEN_STATUSES.map((st) => (
                      <option key={st} value={st}>{STATUS_LABEL[st]}</option>
                    ))}
                  </select>
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <Link
                    href={`/orders/${o.id}/label`}
                    target="_blank"
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs hover:bg-muted"
                    title="Print delivery label with QR"
                  >
                    <Printer className="h-3.5 w-3.5" /> Label
                  </Link>
                  {o.invoiceNo && (
                    <Link
                      href={`/orders/${o.id}/invoice`}
                      target="_blank"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs hover:bg-muted"
                    >
                      <FileText className="h-3.5 w-3.5" /> Invoice
                    </Link>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${accent ? "border-forest/30 bg-forest/5" : "border-border bg-card"}`}>
      <div className="font-serif text-xl sm:text-2xl text-foreground tabular-nums">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
