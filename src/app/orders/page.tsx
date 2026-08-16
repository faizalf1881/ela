"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, ShoppingBag, LogOut, ArrowRight, FileText, RotateCcw, Check, CircleDot, LifeBuoy } from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer, WhatsAppFab } from "@/components/site/Footer";
import { useAuth } from "@/lib/auth-client";
import { useCart } from "@/lib/cart";
import { inr } from "@/lib/utils";
import { STATUS_BADGE, STATUS_LABEL, TRACK_STEPS, type OrderDTO, type OrderStatus } from "@/lib/order-status";

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
      <section className="pt-32 pb-24">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-gold">Your orders</div>
              <h1 className="mt-3 font-serif text-4xl sm:text-5xl text-foreground">Order history</h1>
              {user?.name && <p className="mt-2 text-muted-foreground">Signed in as {user.name}</p>}
            </div>
            <div className="flex gap-2">
              <Link href="/support" className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
                <LifeBuoy className="h-4 w-4" /> Help
              </Link>
              <button onClick={() => load()} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
                <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
              </button>
              <button
                onClick={async () => {
                  await logout();
                  router.push("/");
                }}
                className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted"
              >
                <LogOut className="h-4 w-4" /> Log out
              </button>
            </div>
          </div>

          <div className="mt-10 space-y-5">
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
                <div key={o.id} className="rounded-2xl border border-border bg-card p-5 shadow-soft">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-serif text-lg text-foreground">#{o.id.slice(-6).toUpperCase()}</div>
                      <div className="text-xs text-muted-foreground">{new Date(o.createdAt).toLocaleString("en-IN")}</div>
                    </div>
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_BADGE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
                  </div>

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
                      <div key={it.id} className="flex justify-between">
                        <span>{it.name} × {it.qty}</span>
                        <span>{inr(it.price * it.qty)}</span>
                      </div>
                    ))}
                  </div>

                  {o.discountTotal > 0 && <div className="mt-3 text-xs text-forest">You saved {inr(o.discountTotal)} 🎉</div>}

                  <div className="mt-4 pt-3 border-t border-border flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">
                      {o.paymentMethod === "cod" ? "Cash on delivery" : o.paymentStatus === "PAID" ? "Paid online" : "Payment pending"}
                    </span>
                    <div className="flex items-center gap-4">
                      <span className="font-serif text-lg text-foreground">{inr(o.total)}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button onClick={() => reorder(o)} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                      <RotateCcw className="h-3.5 w-3.5" /> Reorder
                    </button>
                    {o.invoiceNo && (
                      <Link href={`/orders/${o.id}/invoice`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm text-foreground hover:bg-muted">
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
    <div className="mt-5 flex items-center">
      {TRACK_STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={step} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors ${
                  done ? "border-forest bg-forest text-white" : active ? "border-forest bg-forest/10 text-forest" : "border-border bg-card text-muted-foreground"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : active ? <CircleDot className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              </div>
              <span className={`text-[10px] text-center leading-tight ${active || done ? "text-foreground" : "text-muted-foreground"}`}>{STATUS_LABEL[step]}</span>
            </div>
            {i < TRACK_STEPS.length - 1 && <div className={`mx-1 h-0.5 flex-1 rounded ${i < current ? "bg-forest" : "bg-border"}`} />}
          </div>
        );
      })}
    </div>
  );
}
