"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X, BellRing, MapPin, User, Wallet, ShoppingBag, Clock, CalendarClock, VolumeX } from "lucide-react";
import { useAuth } from "@/lib/auth-client";
import { inr } from "@/lib/utils";
import { DEFAULT_ORDER_SOUND } from "@/lib/order-sound-config";
import { audioUnlocked, isAlertMuted, playSound, preloadSound, subscribeAlertMuted, unlockAudio } from "@/lib/order-sound";

export type AlertOrder = {
  id: string;
  invoiceNo: string | null;
  customerName: string;
  address: string;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  codBalanceDue: number;
  placedAt: string;
  deliveryDate: string | null;
  deliverySlot: { label: string } | null;
  deliveryLocation: { name: string; area: string | null } | null;
  items: { name: string; qty: number }[];
  test?: boolean;
};

/** Window events other staff components use to talk to the alert. */
export const TEST_ALERT_EVENT = "ela:test-order-alert";
export const ALERT_CONFIG_EVENT = "ela:alert-config";
export const NEW_ORDERS_EVENT = "ela:new-orders";
export const FOCUS_ORDER_EVENT = "ela:focus-order";
export const FOCUS_ORDER_KEY = "ela.focusOrder";

// What this device has already shown, shared by its tabs (localStorage), and
// this tab's not-yet-shown queue, which survives a reload (sessionStorage).
const STATE_KEY = "ela.orderAlerts.v1";
const PENDING_KEY = "ela.orderAlerts.pending";
const POLL_MS = 6_000;
// An order first noticed later than this (screen was closed) is summarised in a
// toast instead of taking over the screen.
const STALE_MS = 10 * 60_000;
// Each poll re-reads the last minute so a slow database commit is never missed;
// the seen-list stops it alerting twice.
const OVERLAP_MS = 60_000;

type State = { since: string | null; seen: string[] };

function readState(): State {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    if (s && Array.isArray(s.seen)) return s;
  } catch {}
  return { since: null, seen: [] };
}
function writeState(s: State) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {}
}
function readPending(): AlertOrder[] {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING_KEY) || "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
function writePending(p: AlertOrder[]) {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(p.filter((o) => !o.test)));
  } catch {}
}

function sampleOrder(): AlertOrder {
  return {
    id: `test-${Date.now()}`,
    invoiceNo: null,
    customerName: "Test customer",
    address: "Kowdiar",
    total: 450,
    paymentMethod: "razorpay",
    paymentStatus: "PAID",
    codBalanceDue: 0,
    placedAt: new Date().toISOString(),
    deliveryDate: null,
    deliverySlot: { label: "12:30 PM - 1:00 PM" },
    deliveryLocation: { name: "Kowdiar", area: null },
    items: [
      { name: "Traditional Kerala Meals", qty: 2 },
      { name: "Palada Payasam", qty: 1 },
    ],
    test: true,
  };
}

const ist = (iso: string, opts: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", ...opts });

/**
 * New-order alert for admin and kitchen screens (spec #48–#50): plays the
 * restaurant's sound and shows a full-screen green confirmation with the order's
 * key details, then closes itself. Mounted from the admin/kitchen layouts so it
 * stays alive while staff move between pages.
 *
 * Never replays: this device remembers which orders it has shown, so refreshing,
 * reopening or navigating does not trigger an order again. Several orders
 * arriving together are queued and shown one after another.
 */
export function NewOrderAlerts({ boardHref }: { boardHref: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const staff = user?.role === "admin" || user?.role === "kitchen";
  const muted = useSyncExternalStore(subscribeAlertMuted, isAlertMuted, () => false);

  const [queue, setQueue] = useState<AlertOrder[]>([]);
  // Alerts already shown in the current run of back-to-back orders ("2 of 3").
  const [shown, setShown] = useState(0);
  const [config, setConfig] = useState({
    soundUrl: DEFAULT_ORDER_SOUND,
    seconds: 8,
  });
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // Restore this tab's queue after a reload (anything not yet shown).
  useEffect(() => {
    const pending = readPending().filter((o) => Date.now() - Date.parse(o.placedAt) < STALE_MS);
    if (pending.length) setQueue(pending);
  }, []);
  useEffect(() => writePending(queue), [queue]);

  const loadConfig = useCallback(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d?.orderAlert) return;
        setConfig({
          soundUrl: d.orderAlert.soundUrl,
          seconds: d.orderAlert.seconds,
        });
        preloadSound(d.orderAlert.soundUrl);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!staff) return;
    loadConfig();
    window.addEventListener(ALERT_CONFIG_EVENT, loadConfig);
    return () => window.removeEventListener(ALERT_CONFIG_EVENT, loadConfig);
  }, [staff, loadConfig]);

  // Browsers only allow sound after an interaction: unlock on the first one.
  useEffect(() => {
    if (!staff) return;
    const onGesture = () => {
      unlockAudio(configRef.current.soundUrl);
      setTimeout(() => setNeedsUnlock(!audioUnlocked()), 250);
    };
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    const t = setTimeout(() => setNeedsUnlock(!audioUnlocked()), 2000);
    return () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      clearTimeout(t);
    };
  }, [staff]);

  // Poll the new-order feed.
  useEffect(() => {
    if (!staff) return;
    let alive = true;
    async function poll() {
      const state = readState();
      try {
        const qs = state.since ? `?since=${encodeURIComponent(state.since)}` : "";
        const res = await fetch(`/api/orders/alerts${qs}`, {
          cache: "no-store",
        });
        if (!res.ok || !alive) return;
        const data: { now: string; orders: AlertOrder[] } = await res.json();

        // Re-read: another tab on this device may have shown some meanwhile.
        const fresh = readState();
        const seen = new Set(fresh.seen);
        const now = Date.parse(data.now);
        const firstRun = !fresh.since; // just started listening: existing orders are not new
        const incoming: AlertOrder[] = [];
        let missed = 0;
        for (const o of data.orders) {
          if (seen.has(o.id)) continue;
          seen.add(o.id);
          if (firstRun) continue;
          if (now - Date.parse(o.placedAt) > STALE_MS) {
            missed++;
            continue;
          }
          incoming.push(o);
        }
        writeState({
          since: new Date(now - OVERLAP_MS).toISOString(),
          seen: [...seen].slice(-300),
        });

        if (incoming.length) {
          setQueue((q) => [...q, ...incoming]);
          window.dispatchEvent(
            new CustomEvent(NEW_ORDERS_EVENT, {
              detail: incoming.map((o) => o.id),
            }),
          );
        }
        if (missed) {
          toast.message(`${missed} order${missed > 1 ? "s" : ""} came in while this screen was closed`, {
            description: "They are waiting on the Orders board.",
          });
        }
      } catch {}
    }
    void poll();
    const id = setInterval(poll, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [staff]);

  // "Show test alert" from Settings.
  useEffect(() => {
    const onTest = () => setQueue((q) => [...q, sampleOrder()]);
    window.addEventListener(TEST_ALERT_EVENT, onTest);
    return () => window.removeEventListener(TEST_ALERT_EVENT, onTest);
  }, []);

  const current = queue[0] ?? null;
  const dismiss = useCallback(() => {
    setQueue((q) => q.slice(1));
    setShown((n) => n + 1);
  }, []);
  const dismissAll = useCallback(() => setQueue([]), []);
  useEffect(() => {
    if (queue.length === 0) setShown(0);
  }, [queue.length]);

  // Each alert: sound once as it appears, then close after the configured time.
  useEffect(() => {
    if (!current) return;
    if (!mutedRef.current) {
      void playSound(configRef.current.soundUrl).then((ok) => !ok && setNeedsUnlock(true));
    }
    const t = setTimeout(dismiss, configRef.current.seconds * 1000);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, dismiss]);

  function viewOrder(o: AlertOrder) {
    try {
      sessionStorage.setItem(FOCUS_ORDER_KEY, o.id);
    } catch {}
    window.dispatchEvent(new CustomEvent(FOCUS_ORDER_EVENT, { detail: o.id }));
    if (pathname !== boardHref) router.push(boardHref);
    dismiss();
  }

  return (
    <>
      {current && (
        <AlertOverlay
          order={current}
          position={shown + 1}
          total={shown + queue.length}
          seconds={config.seconds}
          muted={muted}
          onClose={dismiss}
          onCloseAll={dismissAll}
          onView={viewOrder}
        />
      )}

      {staff && needsUnlock && !muted && !current && (
        <button
          onClick={() => {
            unlockAudio(configRef.current.soundUrl);
            setTimeout(() => setNeedsUnlock(!audioUnlocked()), 250);
          }}
          className="fixed bottom-4 left-4 z-[60] inline-flex items-center gap-2 rounded-full bg-charcoal px-4 py-2.5 text-sm font-medium text-ivory shadow-elegant hover:bg-charcoal/90"
        >
          <BellRing className="h-4 w-4 text-gold" /> Tap to turn on new-order sound
        </button>
      )}
    </>
  );
}

function AlertOverlay({
  order,
  position,
  total,
  seconds,
  muted,
  onClose,
  onCloseAll,
  onView,
}: {
  order: AlertOrder;
  position: number;
  total: number;
  seconds: number;
  muted: boolean;
  onClose: () => void;
  onCloseAll: () => void;
  onView: (o: AlertOrder) => void;
}) {
  const ref = order.test ? "#TEST" : `#${order.id.slice(-6).toUpperCase()}`;
  const itemCount = order.items.reduce((n, i) => n + i.qty, 0);
  const itemsText =
    order.items
      .slice(0, 3)
      .map((i) => `${i.qty}× ${i.name}`)
      .join(", ") + (order.items.length > 3 ? ` +${order.items.length - 3} more` : "");
  const where = order.deliveryLocation
    ? order.deliveryLocation.area
      ? `${order.deliveryLocation.name}, ${order.deliveryLocation.area}`
      : order.deliveryLocation.name
    : order.address;
  const cod = order.paymentMethod === "cod" && order.paymentStatus !== "PAID";
  const payment = cod
    ? `Cash on delivery${order.codBalanceDue > 0 && order.codBalanceDue < order.total ? ` · ${inr(order.codBalanceDue)} due` : ""}`
    : "Paid online";
  const deliveryDay = order.deliveryDate
    ? new Date(order.deliveryDate).toLocaleDateString("en-IN", {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="new-order-title"
      aria-describedby="new-order-details"
      className="fixed inset-0 z-[80] flex flex-col bg-gradient-to-br from-[#1e7a3c] via-[#17692f] to-[#0f4d22] text-white"
    >
      <div className="flex items-center justify-between px-5 pt-5 sm:px-8 sm:pt-7">
        <div className="flex items-center gap-2">
          {total > 1 && (
            <span className="rounded-full bg-white/15 px-4 py-1.5 text-sm font-medium sm:text-base">
              {position} of {total} new orders
            </span>
          )}
          {muted && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm">
              <VolumeX className="h-4 w-4" /> Sound muted
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {total - position > 0 && (
            <button onClick={onCloseAll} className="rounded-full bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
              Dismiss all
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close alert"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* m-auto centres when there is room and scrolls (instead of clipping) when not. */}
      <div className="flex flex-1 overflow-y-auto px-5 pb-6 sm:px-8">
        <div className="m-auto flex w-full max-w-4xl flex-col items-center text-center 2xl:max-w-6xl">
          {/* Sized from the screen height so it fills a kitchen TV and still fits a laptop. */}
          <div
            className="animate-alert-pop flex shrink-0 items-center justify-center rounded-full bg-white shadow-[0_20px_60px_rgba(0,0,0,0.25)]"
            style={{
              width: "clamp(5.5rem, 16vh, 13rem)",
              height: "clamp(5.5rem, 16vh, 13rem)",
            }}
          >
            <Check className="h-[62%] w-[62%] text-green-600" strokeWidth={3.5} />
          </div>

          <h2 id="new-order-title" className="mt-[2.5vh] font-serif leading-tight" style={{ fontSize: "clamp(2.25rem, 6.5vh, 4.75rem)" }}>
            New Order Received
          </h2>
          <div className="mt-1 font-bold tracking-wide" style={{ fontSize: "clamp(2.25rem, 6.5vh, 5rem)", lineHeight: 1.1 }}>
            {ref}
          </div>
          {order.invoiceNo && <div className="mt-1 text-base text-white/75 sm:text-lg">{order.invoiceNo}</div>}

          <dl id="new-order-details" className="mt-[3vh] grid w-full gap-3 text-left sm:grid-cols-2 sm:gap-4">
            <Detail icon={User} label="Customer" value={order.customerName} />
            <Detail icon={MapPin} label="Deliver to" value={where} />
            <Detail icon={Wallet} label="Amount" value={`${inr(order.total)} · ${payment}`} />
            <Detail icon={ShoppingBag} label={`${itemCount} item${itemCount === 1 ? "" : "s"}`} value={itemsText} />
            <Detail
              icon={Clock}
              label="Placed"
              value={ist(order.placedAt, {
                hour: "numeric",
                minute: "2-digit",
              })}
            />
            {(deliveryDay || order.deliverySlot) && (
              <Detail icon={CalendarClock} label="Delivery" value={[deliveryDay, order.deliverySlot?.label].filter(Boolean).join(" · ")} />
            )}
          </dl>

          {!order.test && (
            <button
              onClick={() => onView(order)}
              className="mt-[3vh] inline-flex min-h-12 shrink-0 items-center gap-2 rounded-full bg-white px-7 py-3 text-base font-semibold text-green-800 hover:bg-white/90"
            >
              View order
            </button>
          )}
        </div>
      </div>

      {/* Countdown until the alert closes itself. */}
      <div className="h-2 w-full bg-white/15">
        <div key={order.id} className="h-full origin-left bg-white/80" style={{ animation: `alert-drain ${seconds}s linear forwards` }} />
      </div>
    </div>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof User; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 rounded-2xl bg-white/10 px-4 py-3 sm:px-5 sm:py-4 2xl:px-7 2xl:py-5">
      <Icon className="mt-1 h-5 w-5 shrink-0 text-white/80 sm:h-6 sm:w-6 2xl:h-8 2xl:w-8" />
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-wider text-white/70 sm:text-sm 2xl:text-base">{label}</dt>
        <dd className="text-lg font-semibold leading-snug break-words sm:text-2xl 2xl:text-4xl">{value}</dd>
      </div>
    </div>
  );
}
