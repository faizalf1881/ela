"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Check, Loader2, Sparkles, CalendarClock, XCircle, ArrowRight } from "lucide-react";
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
};

type Charge = { id: string; amount: number; paidAt: string };
type Subscription = {
  id: string;
  status: "CREATED" | "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED";
  currentEnd: string | null;
  startedAt: string | null;
  plan: Plan;
  charges: Charge[];
};

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

export default function MembershipPage() {
  const router = useRouter();
  const { user, membership, refresh, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

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

  async function subscribe(plan: Plan) {
    if (!user || user.role !== "customer") {
      router.push("/login?next=/membership");
      return;
    }
    setBusy(plan.id);
    let opened = false;
    try {
      const res = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
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
        image: "/ela-logo.jpeg",
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
    <main className={`min-h-screen bg-background ${membership.active ? "premium" : ""}`}>
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

              <div className="mt-6 grid sm:grid-cols-2 gap-3">
                {active.plan.discountPercent > 0 && <Benefit text={`${active.plan.discountPercent}% off every order — applied automatically`} />}
                {active.plan.freeDelivery && <Benefit text="Free delivery on all orders" />}
                {active.plan.benefits.map((b) => <Benefit key={b} text={b} />)}
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

                    <div className="mt-6 space-y-2.5 flex-1">
                      {p.discountPercent > 0 && <Benefit text={`${p.discountPercent}% off every order`} />}
                      {p.freeDelivery && <Benefit text="Free delivery" />}
                      {p.benefits.map((b) => <Benefit key={b} text={b} />)}
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
    </main>
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
