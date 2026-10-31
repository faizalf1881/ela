"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  Camera,
  Repeat,
  CalendarClock,
  Download,
  XCircle,
  Info,
  MessageCircle,
  RotateCw,
  Link2,
  Undo2,
  SearchCheck,
  Loader2,
} from "lucide-react";
import { inr } from "@/lib/utils";
import { downloadCsv } from "@/lib/export";
import { ExportMenu } from "@/components/staff/ExportMenu";
import { CameraScanner, type ScanFeedback } from "@/components/staff/CameraScanner";
import { FOCUS_ORDER_EVENT, FOCUS_ORDER_KEY, NEW_ORDERS_EVENT } from "@/components/staff/NewOrderAlerts";
import { isAlertMuted, setAlertMuted, subscribeAlertMuted } from "@/lib/order-sound";
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
  { key: "OUT_FOR_DELIVERY", label: "Out for delivery", match: (o) => o.status === "OUT_FOR_DELIVERY" },
  { key: "DELIVERED", label: "Delivered", match: (o) => o.status === "DELIVERED" },
  { key: "PENDING", label: "Awaiting payment", match: (o) => o.status === "PENDING" },
  { key: "whatsapp", label: "WhatsApp", match: (o) => o.source === "whatsapp" },
  { key: "subscription", label: "Subscription", match: (o) => o.source === "subscription" },
  { key: "all", label: "All", match: () => true },
];

// Next step in the fulfillment flow + the button label for it.
const ADVANCE: Partial<Record<OrderStatus, { next: OrderStatus; label: string }>> = {
  PENDING: { next: "PLACED", label: "Confirm order" },
  PLACED: { next: "PREPARING", label: "Start preparing" },
  PREPARING: { next: "OUT_FOR_DELIVERY", label: "Out for delivery" },
  OUT_FOR_DELIVERY: { next: "DELIVERED", label: "Mark delivered" },
};

const orderTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

function minutesSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

/** How the order stands for money, in a word or two. */
function paymentText(o: OrderDTO): { text: string; cls: string } {
  if (o.paymentStatus === "REFUNDED") return { text: `Refunded${o.refundAmount ? ` ${inr(o.refundAmount)}` : ""}`, cls: "text-muted-foreground" };
  if (o.refundStatus === "PENDING" || o.refundStatus === "REQUESTED") return { text: "Refund in progress", cls: "text-[oklch(0.55_0.12_75)]" };
  if (o.paymentMethod === "cod") return { text: o.paymentStatus === "PARTIAL" ? `COD · ${inr(o.codBalanceDue ?? 0)} due` : "COD", cls: "text-muted-foreground" };
  if (o.paymentStatus === "PAID") return { text: "Paid online", cls: "text-green-600" };
  if (o.paymentStatus === "FAILED") return { text: "Payment failed", cls: "text-destructive" };
  return { text: "Awaiting payment", cls: "text-muted-foreground" };
}

export function OrdersBoard({ showStats = false }: { showStats?: boolean }) {
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("active");
  const [saving, setSaving] = useState<string | null>(null);
  const muted = useSyncExternalStore(subscribeAlertMuted, isAlertMuted, () => false);
  const [, setTick] = useState(0); // forces elapsed-time re-render
  const [scan, setScan] = useState("");
  const [scanned, setScanned] = useState<string | null>(null); // highlighted order id
  const [cameraOpen, setCameraOpen] = useState(false);
  const [scanBanner, setScanBanner] = useState<(ScanFeedback & { key: number }) | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const audioRef = useRef<AudioContext | null>(null);

  /** Short synthesized tones: [frequency Hz, start s][] with a wave shape. */
  const tone = useCallback((notes: [number, number][], type: OscillatorType = "sine") => {
    if (mutedRef.current) return;
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioRef.current = audioRef.current || new Ctx();
      const ctx = audioRef.current;
      void ctx.resume?.();
      for (const [freq, start] of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + 0.26);
      }
    } catch {}
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.orders);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Highlight an order and bring it into view (from a scan or the new-order alert). */
  const focusOrder = useCallback((id: string) => {
    setFilter("all");
    setScanned(id);
    setTimeout(() => document.getElementById(`order-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
  }, []);

  useEffect(() => {
    load().then(() => {
      // Arrived here from "View order" on the alert.
      try {
        const id = sessionStorage.getItem(FOCUS_ORDER_KEY);
        if (id) {
          sessionStorage.removeItem(FOCUS_ORDER_KEY);
          focusOrder(id);
        }
      } catch {}
    });
    const poll = setInterval(load, 10_000);
    const tick = setInterval(() => setTick((t) => t + 1), 20_000);
    // The alert watcher saw new orders: refresh now rather than on the next poll.
    const onNew = () => void load();
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (!id) return;
      try {
        sessionStorage.removeItem(FOCUS_ORDER_KEY);
      } catch {}
      void load().then(() => focusOrder(id));
    };
    window.addEventListener(NEW_ORDERS_EVENT, onNew);
    window.addEventListener(FOCUS_ORDER_EVENT, onFocus);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
      window.removeEventListener(NEW_ORDERS_EVENT, onNew);
      window.removeEventListener(FOCUS_ORDER_EVENT, onFocus);
    };
  }, [load, focusOrder]);

  async function setStatus(id: string, status: OrderStatus) {
    setSaving(id);
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));
    try {
      const res = await fetch(`/api/orders/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not update status");
      toast.success(`Order → ${STATUS_LABEL[status]}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update status");
      load();
    } finally {
      setSaving(null);
    }
  }

  function showBanner(fb: ScanFeedback) {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setScanBanner({ ...fb, key: Date.now() });
    bannerTimer.current = setTimeout(() => setScanBanner(null), 4500);
  }

  /**
   * A scanned label moves its order to the next workflow step (spec #38): the
   * server decides the step, refuses invalid moves, and ignores a double read.
   */
  async function scanAdvance(raw: string, opts: { banner: boolean }): Promise<ScanFeedback> {
    const code = raw.trim();
    let fb: ScanFeedback;
    try {
      const res = await fetch("/api/orders/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, advance: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const o: OrderDTO = data.order;
        setOrders((prev) => prev.map((x) => (x.id === o.id ? { ...x, status: o.status } : x)));
        setScanned(o.id);
        fb = { tone: "success", title: `#${o.id.slice(-6).toUpperCase()} → ${STATUS_LABEL[data.to as OrderStatus]}`, detail: o.customerName };
        tone([[988, 0], [1319, 0.12]]);
      } else if (data.duplicate) {
        fb = { tone: "info", title: "Already scanned", detail: data.error };
      } else {
        fb = { tone: "error", title: res.status === 404 ? "Unknown code" : "Can't move this order", detail: data.error || "Scan failed" };
        tone([[220, 0], [196, 0.2]], "square");
      }
      const id = data.order?.id as string | undefined;
      if (id) {
        setTimeout(() => document.getElementById(`order-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
      }
    } catch {
      fb = { tone: "error", title: "Scan failed", detail: "Check the connection and try again." };
      tone([[220, 0], [196, 0.2]], "square");
    }
    if (opts.banner) showBanner(fb);
    void load();
    return fb;
  }

  /** Hardware scanners type the code then press Enter. */
  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const code = scan.trim();
    setScan("");
    if (code) await scanAdvance(code, { banner: true });
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
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <form onSubmit={handleScan} className="min-w-0 basis-full sm:basis-auto">
            <label className="relative block">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Scan label QR…"
                className="w-full rounded-full border border-input bg-background pl-9 pr-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-gold/60 sm:w-44 sm:py-2 sm:text-sm"
                title="Scan a delivery-label QR (or type an order/invoice number and press Enter) to move the order to its next step"
              />
            </label>
          </form>
          <button
            onClick={() => setCameraOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-muted"
            title="Scan labels with the device camera: each scan moves the order to its next step"
            aria-label="Scan with camera"
          >
            <Camera className="h-4 w-4" />
          </button>
          <button
            onClick={() => setAlertMuted(!muted)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border hover:bg-muted"
            title={muted ? "Turn new-order and scan sounds back on (this device)" : "Mute new-order and scan sounds on this device"}
            aria-label={muted ? "Unmute sounds" : "Mute sounds"}
            aria-pressed={muted}
          >
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
                    <div className="flex items-center gap-2">
                      <span className="font-serif text-lg text-foreground">#{o.id.slice(-6).toUpperCase()}</span>
                      {o.source === "subscription" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground" title="Generated automatically from a meal plan">
                          <Repeat className="h-3 w-3" /> Subscription
                        </span>
                      )}
                      {o.source === "whatsapp" && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#25D366]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#128C7E]" title="Ordered through the WhatsApp assistant">
                          <MessageCircle className="h-3 w-3" /> WhatsApp
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground" title="Order date and time">
                      {orderTime(o.placedAt ?? o.createdAt)}
                      {o.invoiceNo ? ` · ${o.invoiceNo}` : ""}
                    </div>
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
                      <span className="text-muted-foreground">
                        {it.qty > 1 ? <span className="mr-1 text-[11px]">{inr(it.price)} each ·</span> : null}
                        {inr(it.price * it.qty)}
                      </span>
                    </div>
                  ))}
                  <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span className="tabular-nums">{inr(o.subtotal)}</span>
                    </div>
                    {(o.couponDiscount ?? 0) + (o.membershipDiscount ?? 0) > 0 && (
                      <div className="flex justify-between text-forest">
                        <span>{o.couponDiscount ? "Coupon" : "Member"}{o.couponDiscount && o.membershipDiscount ? " + member" : ""} discount</span>
                        <span className="tabular-nums">− {inr((o.couponDiscount ?? 0) + (o.membershipDiscount ?? 0))}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Delivery</span>
                      <span className="tabular-nums">{o.deliveryFee ? inr(o.deliveryFee) : "Free"}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 border-t border-border pt-3 space-y-1.5 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">{o.customerName}</div>
                  <a href={`tel:${o.customerPhone}`} className="flex items-center gap-2 hover:text-foreground">
                    <Phone className="h-3.5 w-3.5" /> {o.customerPhone}
                  </a>
                  <div className="flex items-start gap-2">
                    <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0" /> <span>{o.address}</span>
                  </div>
                  {(o.deliveryDate || o.deliverySlot) && (
                    <div className="flex items-start gap-2 text-foreground">
                      <CalendarClock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-forest" />
                      <span>
                        {o.deliveryDate ? new Date(o.deliveryDate).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short" }) : ""}
                        {o.deliverySlot ? ` · ${o.deliverySlot.label}` : ""}
                      </span>
                    </div>
                  )}
                  {o.notes && (
                    <div className="flex items-start gap-2 text-foreground">
                      <StickyNote className="h-3.5 w-3.5 mt-0.5 shrink-0 text-gold" /> <span>{o.notes}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <span className="font-serif text-base text-foreground">{inr(o.total)}</span>
                    <span className={`text-xs ${paymentText(o).cls}`}>{paymentText(o).text}</span>
                  </div>
                  {o.notifications?.[0] && <WhatsAppUpdate n={o.notifications[0]} onRetried={load} />}
                  {showStats && <PaymentActions o={o} onChanged={load} />}
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

      {cameraOpen && (
        <CameraScanner continuous onCode={(code) => scanAdvance(code, { banner: false })} onClose={() => setCameraOpen(false)} />
      )}

      {scanBanner && (
        <div
          key={scanBanner.key}
          role="status"
          aria-live="assertive"
          className={`fixed left-1/2 top-20 z-[70] w-[min(92vw,34rem)] -translate-x-1/2 rounded-2xl px-5 py-4 text-white shadow-elegant ${
            scanBanner.tone === "success" ? "bg-green-700" : scanBanner.tone === "info" ? "bg-amber-600" : "bg-red-700"
          }`}
          onClick={() => setScanBanner(null)}
        >
          <div className="flex items-center gap-3">
            {scanBanner.tone === "success" ? (
              <CheckCircle2 className="h-8 w-8 shrink-0" />
            ) : scanBanner.tone === "info" ? (
              <Info className="h-8 w-8 shrink-0" />
            ) : (
              <XCircle className="h-8 w-8 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-lg font-semibold leading-tight">{scanBanner.title}</div>
              {scanBanner.detail && <div className="text-sm text-white/90">{scanBanner.detail}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Admin money actions on an order card: the payment link of an order still
 * waiting to be paid (copy it, or ask the gateway whether it was paid after
 * all), and refunds of a paid one (spec #11/#12).
 */
function PaymentActions({ o, onChanged }: { o: OrderDTO; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [cancelToo, setCancelToo] = useState(o.status !== "DELIVERED" && o.status !== "CANCELLED");
  const onlineDue = o.paymentMethod === "cod" ? o.total - (o.codBalanceDue ?? 0) : o.total;
  const awaiting =
    (o.paymentStatus === "UNPAID" || o.paymentStatus === "FAILED") && o.status !== "CANCELLED" && onlineDue > 0 && o.paymentMethod !== "manual" && o.source !== "subscription";
  const paidOnline = o.paymentStatus === "PAID" || o.paymentStatus === "PARTIAL";
  const refundable = paidOnline && (!o.refundStatus || o.refundStatus === "FAILED");
  const viaGateway = !!(o.cashfreePaymentId || o.razorpayPaymentId);
  const amount = o.paymentStatus === "PARTIAL" ? (o.codConfirmPaid ?? onlineDue) : onlineDue;
  if (!awaiting && !refundable) return null;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }
  const copyLink = () =>
    run("link", async () => {
      const d = await (await fetch(`/api/admin/orders/${o.id}/payment`, { cache: "no-store" })).json();
      if (!d.link) throw new Error(d.error || "No payment link");
      await navigator.clipboard?.writeText(d.link).catch(() => {});
      toast.success("Payment link copied", { description: d.link });
    });
  const check = () =>
    run("check", async () => {
      const res = await fetch(`/api/admin/orders/${o.id}/payment`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not check");
      if (d.paid) {
        toast.success("Paid — the order is now confirmed");
        onChanged();
      } else {
        toast.message(d.status === "CHECK_DASHBOARD" ? "Check the Razorpay dashboard for this order" : d.status === "FAILED" ? "The last payment attempt failed" : "Not paid yet");
      }
    });
  const refund = (manual: boolean) =>
    run(manual ? "manual" : "refund", async () => {
      const res = await fetch(`/api/admin/orders/${o.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manual, cancel: cancelToo }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Refund failed");
      toast.success(manual ? "Refund recorded" : d.order?.paymentStatus === "REFUNDED" ? `${inr(amount)} refunded` : "Refund started — the gateway confirms it shortly");
      setRefunding(false);
      onChanged();
    });

  return (
    <div className="pt-1">
      {awaiting && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={copyLink} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-60">
            {busy === "link" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />} Copy payment link
          </button>
          <button onClick={check} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-60">
            {busy === "check" ? <Loader2 className="h-3 w-3 animate-spin" /> : <SearchCheck className="h-3 w-3" />} Check payment
          </button>
        </div>
      )}
      {refundable &&
        (refunding ? (
          <div className="mt-1 space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
            <div className="text-foreground">
              Refund <strong>{inr(amount)}</strong>{" "}
              {viaGateway ? `to the customer through ${o.cashfreePaymentId ? "Cashfree" : "Razorpay"}?` : "— this order wasn't paid through a gateway, so record a refund you made yourself."}
            </div>
            {o.status !== "DELIVERED" && o.status !== "CANCELLED" && (
              <label className="flex items-center gap-1.5 text-foreground">
                <input type="checkbox" checked={cancelToo} onChange={(e) => setCancelToo(e.target.checked)} /> Also cancel the order (the customer is told on WhatsApp)
              </label>
            )}
            <div className="flex flex-wrap gap-1.5">
              {viaGateway && (
                <button
                  onClick={() => refund(false)}
                  disabled={busy !== null}
                  className="inline-flex items-center gap-1 rounded-full bg-destructive px-3 py-1.5 font-medium text-destructive-foreground disabled:opacity-60"
                >
                  {busy === "refund" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Refund now
                </button>
              )}
              <button onClick={() => refund(true)} disabled={busy !== null} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-60">
                {busy === "manual" ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Already refunded — record it
              </button>
              <button onClick={() => setRefunding(false)} className="rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted">
                Keep
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setRefunding(true)} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10">
            <Undo2 className="h-3 w-3" /> Refund{o.refundStatus === "FAILED" ? " (last attempt failed)" : ""}…
          </button>
        ))}
    </div>
  );
}

type OrderUpdate = NonNullable<OrderDTO["notifications"]>[number];

/** The customer's latest WhatsApp status update for an order, with a retry when it failed (spec #46). */
function WhatsAppUpdate({ n, onRetried }: { n: OrderUpdate; onRetried: () => void }) {
  const [busy, setBusy] = useState(false);
  const what = STATUS_LABEL[n.toStatus];
  const state =
    n.status === "FAILED"
      ? { text: "failed", cls: "text-destructive" }
      : n.status === "SKIPPED"
        ? { text: "not sent", cls: "text-muted-foreground" }
        : n.status === "PENDING"
          ? { text: "sending…", cls: "text-muted-foreground" }
          : n.deliveryStatus === "read"
            ? { text: "✓✓ read", cls: "text-blue-600" }
            : n.deliveryStatus === "delivered"
              ? { text: "✓✓ delivered", cls: "text-green-700" }
              : { text: "✓ sent", cls: "text-green-700" };

  async function retry() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/notifications/${n.id}/retry`, { method: "POST" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Retry failed");
      if (d.notification?.status === "SENT") toast.success("WhatsApp update sent");
      else toast.error(d.notification?.error || "Still failing");
      onRetried();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Retry failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 pt-1 text-xs" title={n.error || undefined}>
      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <MessageCircle className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          WhatsApp &ldquo;{what}&rdquo;: <span className={`font-medium ${state.cls}`}>{state.text}</span>
        </span>
      </span>
      {(n.status === "FAILED" || n.status === "SKIPPED") && (
        <button
          onClick={retry}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-60"
        >
          <RotateCw className={`h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Retry
        </button>
      )}
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
