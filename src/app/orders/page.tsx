"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, ShoppingBag, LogOut, ArrowRight, FileText, RotateCcw, Check, CircleDot, LifeBuoy, CalendarClock, MapPin } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer, WhatsAppFab } from "@/components/site/Footer";
import { useAuth } from "@/lib/auth-client";
import { useCart } from "@/lib/cart";
import { inr } from "@/lib/utils";
import { STATUS_BADGE, STATUS_LABEL, TRACK_STEPS, type OrderDTO, type OrderStatus } from "@/lib/order-status";

// "25 Sept, 11:13 pm" — the order's time in India, without seconds.
const placedAt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// Delivery dates are calendar days stored at UTC midnight.
const deliveryDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });

export default function OrdersPage() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const { add, setQty, openCart } = useCart();
  const [orders, setOrders] = useState<OrderDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (spin = true) => {
    if (spin) setLoading(true);
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      if (res.ok) setOrders((await res.json()).orders);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.role !== "customer") {
      router.replace("/login?next=/orders");
      return;
    }
    load();
    const t = setInterval(() => load(false), 15_000); // live status
    return () => clearInterval(t);
  }, [user, authLoading, router, load]);

  function reorder(o: OrderDTO) {
    let added = 0;
    for (const it of o.items) {
      if (!it.menuItemId) continue;
      add({ id: it.menuItemId, name: it.name, price: it.price, mrp: it.mrp, imageUrl: null });
      setQty(it.menuItemId, it.qty);
      added++;
    }
    if (added === 0) return toast.error("These items are no longer available.");
    toast.success("Added to cart");
    openCart();
  }

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-28 pb-24 sm:pt-32">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-gold">Your orders</div>
              <h1 className="mt-2 font-serif text-3xl text-foreground sm:mt-3 sm:text-5xl">Order history</h1>
              {user?.name && <p className="mt-1 text-sm text-muted-foreground sm:mt-2 sm:text-base">Signed in as {user.name}</p>}
            </div>
            <div className="flex gap-2">
              <Link href="/support" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
                <LifeBuoy className="h-4 w-4" /> Help
              </Link>
              <button onClick={() => load()} className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
              <button
                onClick={async () => {
                  await logout();
                  router.push("/");
                }}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-4 sm:mt-10 sm:space-y-5">
            {loading && orders.length === 0 ? (
              Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-56 rounded-2xl border border-border bg-card animate-pulse" />)
            ) : orders.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
                <ShoppingBag className="h-8 w-8 mx-auto text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">You haven&apos;t placed any orders yet.</p>
                <Link href="/#menu" className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
                  Browse the menu <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              orders.map((o) => (
                <div key={o.id} className="rounded-2xl border border-border bg-card p-4 shadow-soft sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-serif text-lg text-foreground">#{o.id.slice(-6).toUpperCase()}</div>
                      <div className="text-xs text-muted-foreground">Placed {placedAt(o.createdAt)}</div>
                    </div>
                    <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                  </div>

                  {/* When and where — the first thing a pre-order customer looks for. */}
                  {(o.deliveryDate || o.deliverySlot || o.address) && (
                    <div className="mt-3 space-y-1 rounded-xl bg-muted/50 px-3 py-2 text-sm text-foreground">
                      {(o.deliveryDate || o.deliverySlot) && (
                        <div className="flex items-start gap-2">
                          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
                          <span>
                            {o.deliveryDate ? deliveryDay(o.deliveryDate) : ""}
                            {o.deliveryDate && o.deliverySlot ? " · " : ""}
                            {o.deliverySlot?.label}
                          </span>
                        </div>
                      )}
                      {o.address && (
                        <div className="flex items-start gap-2 text-muted-foreground">
                          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0 break-words">{o.address}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Live tracker */}
                  {o.status === "CANCELLED" ? (
                    <div className="mt-4 rounded-xl bg-destructive/10 px-4 py-2 text-sm text-destructive">This order was cancelled.</div>
                  ) : o.status === "PENDING" ? (
                    <div className="mt-4 rounded-xl bg-muted px-4 py-2 text-sm text-muted-foreground">Awaiting payment.</div>
                  ) : (
                    <Tracker status={o.status} />
                  )}

                  <div className="mt-4 space-y-1 text-sm text-muted-foreground">
                    {o.items.map((it) => (
                      <div key={it.id} className="flex justify-between gap-3">
                        <span className="min-w-0">
                          {it.name} × {it.qty}
                        </span>
                        <span className="shrink-0 tabular-nums">{inr(it.price * it.qty)}</span>
                      </div>
                    ))}
                  </div>

                  {o.discountTotal > 0 && <div className="mt-3 text-xs text-forest">You saved {inr(o.discountTotal)} 🎉</div>}

                  <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">
                      {o.paymentMethod === "cod" ? "Cash on delivery" : o.paymentStatus === "PAID" ? "Paid online" : "Payment pending"}
                    </span>
                    <span className="text-lg font-semibold tabular-nums text-foreground">{inr(o.total)}</span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button onClick={() => reorder(o)} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                      <RotateCcw className="h-3.5 w-3.5" /> Reorder
                    </button>
                    {o.invoiceNo && (
                      <Link href={`/orders/${o.id}/invoice`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">
                        <FileText className="h-3.5 w-3.5" /> Invoice
                      </Link>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
      <Footer />
      <WhatsAppFab />
    </main>
  );
}

function Tracker({ status }: { status: OrderStatus }) {
  const current = TRACK_STEPS.indexOf(status);
  return (
    <ol className="mt-5 grid grid-cols-4" aria-label={`Order status: ${STATUS_LABEL[status]}`}>
      {TRACK_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step} className="relative flex flex-col items-center text-center" aria-current={active ? "step" : undefined}>
            {/* Line from the previous step's circle to this one. */}
            {i > 0 && (
              <span
                className={`absolute right-1/2 top-3.5 h-0.5 w-full -translate-y-1/2 ${i <= current ? "bg-forest" : "bg-border"}`}
                aria-hidden
              />
            )}
            <div
              className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors ${
                done ? "border-forest bg-forest text-white" : active ? "border-forest bg-card text-forest" : "border-border bg-card text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-4 w-4" /> : active ? <CircleDot className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            </div>
            <span className={`mt-1.5 px-0.5 text-[11px] leading-tight ${active ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground"}`}>
              {STATUS_LABEL[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
