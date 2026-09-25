"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Check, Loader2, Sparkles, CalendarClock, XCircle, ArrowRight, UtensilsCrossed, MapPin, Clock, X } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer, WhatsAppFab } from "@/components/site/Footer";
import { useAuth } from "@/lib/auth-client";
import { inr } from "@/lib/utils";

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
  kind: "DISCOUNT" | "MEAL";
  serviceDays: number[];
  durationDays: number | null;
  mealItems: { id: string; qty: number; menuItem: { id: string; name: string } }[];
};

type Charge = { id: string; amount: number; paidAt: string };
type Subscription = {
  id: string;
  status: "CREATED" | "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED";
  currentEnd: string | null;
  startedAt: string | null;
  plan: Plan;
  charges: Charge[];
  startDate: string | null;
  endDate: string | null;
  deliveryLocation: { id: string; name: string } | null;
  deliverySlot: { id: string; label: string } | null;
};

type MealChoice = { deliveryLocationId: string; deliverySlotId?: string; startDate: string };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const cycleLabel = (p: Plan) =>
  p.intervalCount > 1
    ? `every ${p.intervalCount} ${p.interval.toLowerCase().replace("ly", p.interval === "MONTHLY" ? "ths" : "s")}`
    : p.interval === "MONTHLY"
      ? "per month"
      : p.interval === "WEEKLY"
        ? "per week"
        : "per year";

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Mon–Sat", "Every day", or "Mon, Wed, Fri". */
function serviceDaysLabel(days: number[]): string {
  const d = [...new Set(days)].sort((a, b) => a - b);
  if (d.length === 7) return "Every day";
  if (d.length === 0) return "No delivery days set";
  const run = d.every((n, i) => i === 0 || n === d[i - 1] + 1);
  if (run && d.length >= 3) return `${DAY_SHORT[d[0]]}–${DAY_SHORT[d[d.length - 1]]}`;
  return d.map((n) => DAY_SHORT[n]).join(", ");
}

// Dates are handled as IST calendar days (YYYY-MM-DD), matching the server.
const istToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDayKey = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekdayOfKey = (key: string) => new Date(`${key}T00:00:00Z`).getUTCDay();
const prettyDay = (key: string) =>
  new Date(`${key}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Service dates a new meal plan may start on: from tomorrow, the next two weeks. */
function startOptions(serviceDays: number[]): string[] {
  const today = istToday();
  const out: string[] = [];
  for (let i = 1; i <= 14 && out.length < 7; i++) {
    const key = addDayKey(today, i);
    if (serviceDays.includes(weekdayOfKey(key))) out.push(key);
  }
  return out;
}

/**
 * The plan's perk lines. The discount and free-delivery flags already produce
 * their own line, so a free-text benefit repeating them is dropped.
 */
function perkLines(p: Plan): string[] {
  const lines: string[] = [];
  if (p.discountPercent > 0) lines.push(`${p.discountPercent}% off every order`);
  if (p.freeDelivery) lines.push("Free delivery");
  for (const b of p.benefits) {
    const t = b.toLowerCase();
    if (p.freeDelivery && t.includes("free delivery")) continue;
    if (p.discountPercent > 0 && /\d+\s*%\s*off/.test(t)) continue;
    lines.push(b);
  }
  return lines;
}

export default function MembershipPage() {
  const router = useRouter();
  const { user, membership, refresh, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [mealSetup, setMealSetup] = useState<Plan | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([
        fetch("/api/plans", { cache: "no-store" }).then((r) => r.json()),
        user?.role === "customer"
          ? fetch("/api/subscriptions", { cache: "no-store" }).then((r) => r.json())
          : Promise.resolve({ subscriptions: [] }),
      ]);
      setPlans(p.plans || []);
      setSubs(s.subscriptions || []);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  const active = subs.find((s) => s.status === "ACTIVE") || null;

  async function subscribe(plan: Plan, meal?: MealChoice) {
    if (!user || user.role !== "customer") {
      router.push("/login?next=/membership");
      return;
    }
    // Meal plans need a standing delivery address and time before billing starts.
    if (plan.kind === "MEAL" && !meal) {
      setMealSetup(plan);
      return;
    }
    setMealSetup(null);
    setBusy(plan.id);
    let opened = false;
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id, ...(meal ?? {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not start the membership");

      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) throw new Error("Could not load the payment gateway");

      const rzp = new window.Razorpay({
        key: data.razorpay.keyId,
        subscription_id: data.razorpay.subscriptionId,
        name: "Ela & Co.",
        description: `${plan.name} membership`,
        image: `${window.location.origin}/brand/ela-logo.png`,
        prefill: { name: user.name || "", contact: user.phone || "" },
        theme: { color: "#4B5A24" },
        handler: async (resp: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
          try {
            const vr = await fetch("/api/subscriptions/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(resp),
            });
            const vd = await vr.json();
            if (!vr.ok) throw new Error(vd.error || "Verification failed");
            toast.success(`Welcome to ${plan.name}! 🌟`);
            await refresh();
            await load();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Verification failed");
          } finally {
            setBusy(null);
          }
        },
        modal: {
          ondismiss: () => {
            setBusy(null);
            toast.message("Membership not started", { description: "You cancelled the authorisation." });
          },
        },
      });
      rzp.on("payment.failed", (r: unknown) => {
        setBusy(null);
        toast.error((r as { error?: { description?: string } })?.error?.description || "Payment failed");
      });
      opened = true;
      rzp.open();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (!opened) setBusy(null);
    }
  }

  async function cancel(sub: Subscription) {
    if (!confirm(`Cancel your ${sub.plan.name} membership? You'll keep the benefits until ${sub.currentEnd ? new Date(sub.currentEnd).toLocaleDateString("en-IN") : "the end of this cycle"}.`)) return;
    setBusy(sub.id);
    try {
      const res = await fetch(`/api/subscriptions/${sub.id}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error || "Could not cancel");
      toast.success("Membership cancelled");
      await refresh();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-24">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-flex items-center gap-2 rounded-full bg-gold/15 px-4 py-1.5 text-xs uppercase tracking-[0.3em] text-[oklch(0.52_0.12_75)]">
              <Crown className="h-3.5 w-3.5" /> Membership
            </div>
            <h1 className="mt-5 font-serif text-4xl sm:text-6xl text-foreground text-balance">
              {membership.active ? "You're a premium member." : "Eat well, every week."}
            </h1>
            <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
              {membership.active
                ? "Your benefits apply automatically at checkout — nothing to remember."
                : "Join the Ela & Co. table: automatic savings on every order, free delivery, and priority from our kitchen."}
            </p>
          </div>

          {/* Active membership card */}
          {active && (
            <div className="mt-12 rounded-3xl border-2 border-gold/50 bg-gradient-to-br from-gold/10 to-transparent p-8 shadow-elegant">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-gold px-3 py-1 text-xs font-semibold text-charcoal">
                    <Sparkles className="h-3.5 w-3.5" /> ACTIVE
                  </div>
                  <h2 className="mt-3 font-serif text-3xl text-foreground">{active.plan.name}</h2>
                  <p className="text-muted-foreground">{inr(active.plan.price)} {cycleLabel(active.plan)}</p>
                  {active.currentEnd && (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarClock className="h-4 w-4" /> Renews on {new Date(active.currentEnd).toLocaleDateString("en-IN")}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => cancel(active)}
                  disabled={busy === active.id}
                  className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:text-destructive hover:border-destructive/40 disabled:opacity-60"
                >
                  {busy === active.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Cancel
                </button>
              </div>

              {active.plan.kind === "MEAL" && (
                <div className="mt-6 rounded-2xl bg-card/70 ring-1 ring-gold/30 p-4 text-sm">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <UtensilsCrossed className="h-4 w-4 text-forest" /> Your daily meals
                  </div>
                  <ul className="mt-2 space-y-1 text-foreground/90">
                    {active.plan.mealItems.map((m) => (
                      <li key={m.id}>{m.qty} × {m.menuItem.name}</li>
                    ))}
                  </ul>
                  <div className="mt-3 grid gap-1.5 text-muted-foreground sm:grid-cols-2">
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarClock className="h-3.5 w-3.5" /> {serviceDaysLabel(active.plan.serviceDays)}
                      {active.startDate ? ` · from ${prettyDay(active.startDate.slice(0, 10))}` : ""}
                      {active.endDate ? ` to ${prettyDay(active.endDate.slice(0, 10))}` : ""}
                    </span>
                    {active.deliveryLocation && (
                      <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {active.deliveryLocation.name}</span>
                    )}
                    {active.deliverySlot && (
                      <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> {active.deliverySlot.label}</span>
                    )}
                  </div>
                </div>
              )}

              <div className="mt-6 grid sm:grid-cols-2 gap-3">
                {perkLines(active.plan).map((b) => <Benefit key={b} text={b} />)}
              </div>

              {active.charges.length > 0 && (
                <div className="mt-8 border-t border-gold/30 pt-5">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Payment history</div>
                  <div className="mt-2 space-y-1.5">
                    {active.charges.map((c) => (
                      <div key={c.id} className="flex justify-between text-sm">
                        <span className="text-muted-foreground">{new Date(c.paidAt).toLocaleDateString("en-IN")}</span>
                        <span className="text-foreground">{inr(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Plans */}
          {loading ? (
            <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-80 rounded-3xl border border-border bg-card animate-pulse" />)}
            </div>
          ) : plans.length === 0 ? (
            <div className="mt-12 rounded-3xl border border-dashed border-border bg-card p-12 text-center">
              <Crown className="h-8 w-8 mx-auto text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">Membership plans are coming soon.</p>
              <Link href="/#menu" className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
                Browse the menu <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className={`mt-12 grid gap-6 ${plans.length === 1 ? "max-w-md mx-auto" : plans.length === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3"}`}>
              {plans.map((p) => {
                const isCurrent = active?.plan.id === p.id;
                return (
                  <div key={p.id} className={`flex flex-col rounded-3xl border bg-card p-7 shadow-soft ${isCurrent ? "border-gold/60" : "border-border"}`}>
                    <h3 className="font-serif text-2xl text-foreground">{p.name}</h3>
                    {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
                    <div className="mt-5 flex items-baseline gap-1.5">
                      <span className="font-serif text-4xl text-foreground">{inr(p.price)}</span>
                      <span className="text-sm text-muted-foreground">{cycleLabel(p)}</span>
                    </div>

                    {p.kind === "MEAL" && (
                      <div className="mt-5 rounded-2xl bg-forest/5 p-4 text-sm">
                        <div className="flex items-center gap-2 font-medium text-foreground">
                          <UtensilsCrossed className="h-4 w-4 text-forest" /> Delivered {serviceDaysLabel(p.serviceDays).replace(/^Every day$/, "every day")}
                        </div>
                        <ul className="mt-2 space-y-1 text-foreground/85">
                          {p.mealItems.map((m) => (
                            <li key={m.id}>{m.qty} × {m.menuItem.name}</li>
                          ))}
                        </ul>
                        {p.durationDays && <p className="mt-2 text-xs text-muted-foreground">Runs for {p.durationDays} days</p>}
                      </div>
                    )}

                    <div className="mt-6 space-y-2.5 flex-1">
                      {perkLines(p).map((b) => <Benefit key={b} text={b} />)}
                    </div>

                    <button
                      onClick={() => subscribe(p)}
                      disabled={busy === p.id || isCurrent || !!active}
                      className="mt-7 w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crown className="h-4 w-4" />}
                      {isCurrent ? "Your current plan" : active ? "Cancel current plan first" : "Subscribe with AutoPay"}
                    </button>
                    {!active && (
                      <p className="mt-2 text-center text-[11px] text-muted-foreground">
                        Secure eMandate via Razorpay · cancel anytime
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Past memberships */}
          {subs.some((s) => s.status !== "ACTIVE") && (
            <div className="mt-12">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Past memberships</div>
              <div className="mt-3 space-y-2">
                {subs.filter((s) => s.status !== "ACTIVE").map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 text-sm">
                    <div>
                      <div className="text-foreground">{s.plan.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {s.startedAt ? new Date(s.startedAt).toLocaleDateString("en-IN") : "—"} · {s.status.toLowerCase()}
                      </div>
                    </div>
                    <span className="text-muted-foreground">{inr(s.plan.price)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>
      <Footer />
      <WhatsAppFab />
      {mealSetup && (
        <MealSetup plan={mealSetup} onClose={() => setMealSetup(null)} onConfirm={(choice) => subscribe(mealSetup, choice)} />
      )}
    </main>
  );
}

type Loc = { id: string; name: string; area: string | null };
type SlotOpt = { id: string; label: string };

/** Collects where and when a meal plan delivers, before AutoPay starts. */
function MealSetup({ plan, onClose, onConfirm }: { plan: Plan; onClose: () => void; onConfirm: (c: MealChoice) => void }) {
  const [locations, setLocations] = useState<Loc[]>([]);
  const [slots, setSlots] = useState<SlotOpt[]>([]);
  const [loading, setLoading] = useState(true);
  const dates = useMemo(() => startOptions(plan.serviceDays), [plan.serviceDays]);
  const [locationId, setLocationId] = useState("");
  const [slotId, setSlotId] = useState("");
  const [startDate, setStartDate] = useState(dates[0] ?? "");

  useEffect(() => {
    Promise.all([
      fetch("/api/locations", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/slots", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([l, s]) => {
        setLocations(l.locations || []);
        setSlots(s.slots || []);
        if ((s.slots || []).length === 1) setSlotId(s.slots[0].id);
      })
      .catch(() => toast.error("Could not load delivery options"))
      .finally(() => setLoading(false));
  }, []);

  function confirm() {
    if (!locationId) return toast.error("Please choose where your meals should be delivered.");
    if (slots.length > 0 && !slotId) return toast.error("Please choose a delivery time.");
    if (!startDate) return toast.error("Please choose a start date.");
    onConfirm({ deliveryLocationId: locationId, deliverySlotId: slotId || undefined, startDate });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Set up ${plan.name}`}
        className="w-full max-w-lg rounded-3xl bg-card ring-1 ring-border shadow-elegant p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl text-foreground">Set up your meals</h2>
          <button onClick={onClose} aria-label="Close" className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {plan.name} · {plan.mealItems.map((m) => `${m.qty} × ${m.menuItem.name}`).join(", ")} · {serviceDaysLabel(plan.serviceDays)}
        </p>

        {loading ? (
          <div className="mt-6 flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-xs text-muted-foreground">Deliver to</span>
              <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-3 text-sm">
                <option value="">Choose your area</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.area ? `${l.name} — ${l.area}` : l.name}
                  </option>
                ))}
              </select>
            </label>

            {slots.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground">Delivery time</span>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {slots.map((sl) => (
                    <button
                      key={sl.id}
                      type="button"
                      onClick={() => setSlotId(sl.id)}
                      className={`min-h-11 rounded-xl border px-2 py-2 text-[13px] sm:text-sm whitespace-nowrap ${
                        slotId === sl.id ? "border-forest bg-forest/5 text-foreground" : "border-border text-foreground/80 hover:border-forest/40"
                      }`}
                    >
                      {sl.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className="block">
              <span className="text-xs text-muted-foreground">First delivery</span>
              <select value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-3 text-sm">
                {dates.map((d) => (
                  <option key={d} value={d}>
                    {prettyDay(d)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={confirm}
            disabled={loading}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Crown className="h-4 w-4" /> Continue to AutoPay
          </button>
          <button onClick={onClose} className="rounded-full border border-border px-6 py-3.5 text-sm hover:bg-muted">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-forest/10">
        <Check className="h-3 w-3 text-forest" />
      </span>
      <span className="text-foreground/90">{text}</span>
    </div>
  );
}
