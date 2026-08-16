"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Minus,
  Plus,
  Trash2,
  ShoppingBag,
  ArrowRight,
  CheckCircle2,
  CreditCard,
  Wallet,
  Loader2,
  LogIn,
  FileText,
  TicketPercent,
  X,
} from "lucide-react";
import { Navbar } from "@/components/site/Navbar";
import { Footer, WhatsAppFab } from "@/components/site/Footer";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth-client";
import { inr } from "@/lib/utils";

type RazorpayResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type Location = { id: string; name: string; area: string | null; deliveryFee: number };
type Applied = { code: string; discount: number; label: string };

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void; on: (e: string, cb: (r: unknown) => void) => void };
  }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function CheckoutPage() {
  const router = useRouter();
  const { items, setQty, remove, subtotal, clear, count } = useCart();
  const { user, loading: authLoading } = useAuth();
  const [form, setForm] = useState({ name: "", phone: "", locationId: "", method: "razorpay" as "razorpay" | "cod" });
  const [locations, setLocations] = useState<Location[]>([]);
  const [couponInput, setCouponInput] = useState("");
  const [applied, setApplied] = useState<Applied | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const [placed, setPlaced] = useState<null | { id: string; total: number; method: string }>(null);
  const [busy, setBusy] = useState(false);
  const [store, setStore] = useState<{ accepting: boolean; message: string | null }>({ accepting: true, message: null });

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStore({ accepting: d.acceptingOrders, message: d.closedMessage }))
      .catch(() => {});
    fetch("/api/locations", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setLocations(d.locations || []))
      .catch(() => {});
  }, []);

  // Auto-fill from the logged-in customer's profile — no need to re-enter (spec #16).
  useEffect(() => {
    if (user?.role === "customer") {
      setForm((f) => ({
        ...f,
        name: f.name || user.name || "",
        phone: f.phone || user.phone || "",
      }));
    }
  }, [user]);

  // If the cart changes, drop any applied coupon so the discount can't go stale.
  useEffect(() => {
    setApplied(null);
  }, [subtotal]);

  const selectedLocation = locations.find((l) => l.id === form.locationId) || null;
  const deliveryFee = subtotal > 0 && selectedLocation ? selectedLocation.deliveryFee : 0;
  const couponDiscount = applied?.discount ?? 0;
  const total = Math.max(0, subtotal - couponDiscount) + deliveryFee;
  const isCustomer = user?.role === "customer";

  async function applyCoupon() {
    if (!couponInput.trim()) return;
    if (!isCustomer) {
      router.push("/login?next=/checkout");
      return;
    }
    setCouponBusy(true);
    try {
      const res = await fetch("/api/coupons/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponInput.trim(), subtotal }),
      });
      const data = await res.json();
      if (!data.ok) {
        setApplied(null);
        toast.error(data.error || "Invalid coupon");
        return;
      }
      setApplied({ code: data.code, discount: data.discount, label: data.label });
      toast.success(`Coupon ${data.code} applied — you saved ${inr(data.discount)}`);
    } catch {
      toast.error("Could not check that coupon");
    } finally {
      setCouponBusy(false);
    }
  }

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    if (items.length === 0) return toast.error("Your cart is empty");
    if (!store.accepting) return toast.error(store.message || "We're not accepting orders right now.");
    if (!isCustomer) {
      router.push("/login?next=/checkout");
      return;
    }
    if (!form.name || !form.phone) return toast.error("Please fill your name and phone");
    if (!form.locationId) return toast.error("Please choose a delivery location");

    setBusy(true);
    let modalOpened = false;
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ id: i.id, qty: i.qty })),
          name: form.name,
          phone: form.phone,
          deliveryLocationId: form.locationId,
          couponCode: applied?.code,
          paymentMethod: form.method,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          router.push("/login?next=/checkout");
          return;
        }
        throw new Error(data.error || "Could not place order");
      }

      if (data.paymentMethod === "cod") {
        setPlaced({ id: data.order.id, total: data.order.total, method: "cod" });
        clear();
        toast.success("Order placed! Pay cash on delivery.");
        return;
      }

      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) throw new Error("Could not load payment gateway");

      const rzp = new window.Razorpay({
        key: data.razorpay.keyId,
        amount: data.razorpay.amount,
        currency: data.razorpay.currency,
        name: "Ela & Co.",
        description: `Order ${data.order.id}`,
        image: "/ela-logo.jpeg",
        order_id: data.razorpay.orderId,
        prefill: { name: form.name, contact: form.phone },
        notes: { location: selectedLocation?.name || "" },
        theme: { color: "#4B5A24" },
        handler: async (response: RazorpayResponse) => {
          try {
            const vr = await fetch("/api/payments/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const vd = await vr.json();
            if (!vr.ok) throw new Error(vd.error || "Verification failed");
            setPlaced({ id: vd.order.id, total: vd.order.total, method: "razorpay" });
            clear();
            toast.success("Payment successful! Order confirmed.");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Payment verification failed");
          } finally {
            setBusy(false);
          }
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            toast.message("Payment cancelled", { description: "Your order was not placed." });
          },
        },
      });

      rzp.on("payment.failed", (resp: unknown) => {
        setBusy(false);
        const desc = (resp as { error?: { description?: string } })?.error?.description;
        toast.error(desc || "Payment failed. Please try again.");
      });

      modalOpened = true;
      rzp.open();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (!modalOpened) setBusy(false);
    }
  }

  if (placed) {
    return (
      <main className="min-h-screen bg-background">
        <Navbar />
        <section className="pt-40 pb-32">
          <div className="mx-auto max-w-2xl px-6 text-center">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-forest/10">
              <CheckCircle2 className="h-8 w-8 text-forest" />
            </div>
            <h1 className="mt-6 font-serif text-5xl text-foreground">Order placed</h1>
            <p className="mt-3 text-muted-foreground">
              Your order <strong className="text-foreground">#{placed.id.slice(-6).toUpperCase()}</strong> for{" "}
              <strong className="text-foreground">{inr(placed.total)}</strong>{" "}
              {placed.method === "cod" ? "is confirmed — pay cash on delivery." : "is confirmed and paid."} Our kitchen will
              start preparing it shortly.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 justify-center">
              <Link href="/orders" className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Track your order <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href={`/orders/${placed.id}/invoice`} className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-muted">
                <FileText className="h-4 w-4" /> View invoice
              </Link>
              <Link href="/" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-medium text-foreground hover:bg-muted">
                Back to home
              </Link>
            </div>
          </div>
        </section>
        <Footer />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <section className="pt-32 pb-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="text-xs uppercase tracking-[0.3em] text-gold">Checkout</div>
          <h1 className="mt-3 font-serif text-4xl sm:text-5xl text-foreground">Review &amp; place your order</h1>
          <p className="mt-2 text-muted-foreground">
            {count === 0 ? "Your cart is empty." : `${count} item${count > 1 ? "s" : ""} in cart.`}
          </p>

          {!store.accepting && (
            <div className="mt-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-foreground">
              {store.message || "We're currently not accepting orders. You can browse, but checkout is paused."}
            </div>
          )}

          {!authLoading && !isCustomer && count > 0 && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-gold/40 bg-gold/10 p-4">
              <div className="text-sm text-foreground">Log in with WhatsApp to place your order.</div>
              <Link href="/login?next=/checkout" className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
                <LogIn className="h-4 w-4" /> Login
              </Link>
            </div>
          )}

          <div className="mt-10 grid lg:grid-cols-5 gap-8">
            {/* Cart */}
            <div className="lg:col-span-3 space-y-4">
              {items.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-border p-12 text-center bg-card">
                  <ShoppingBag className="h-8 w-8 mx-auto text-muted-foreground" />
                  <p className="mt-4 text-muted-foreground">Nothing here yet.</p>
                  <Link href="/#menu" className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">
                    Browse the menu <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ) : (
                items.map((i) => (
                  <div key={i.id} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-4">
                    <div className="flex-1">
                      <div className="font-serif text-lg text-foreground">{i.name}</div>
                      <div className="text-xs text-muted-foreground">{inr(i.price)} each</div>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-muted p-1">
                      <button onClick={() => setQty(i.id, i.qty - 1)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-background" aria-label="Decrease">
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-6 text-center text-sm font-medium">{i.qty}</span>
                      <button onClick={() => setQty(i.id, i.qty + 1)} className="h-8 w-8 inline-flex items-center justify-center rounded-full hover:bg-background" aria-label="Increase">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="w-20 text-right font-medium">{inr(i.qty * i.price)}</div>
                    <button onClick={() => remove(i.id)} className="h-9 w-9 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {/* Summary + form */}
            <form onSubmit={placeOrder} className="lg:col-span-2 space-y-6">
              <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
                <h2 className="font-serif text-2xl text-foreground">Your details</h2>
                <div className="mt-4 space-y-3">
                  <Field label="Full name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} placeholder="Anjali Nair" />
                  <Field label="Phone (WhatsApp)" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} placeholder="+91 9XXXXXXXXX" type="tel" />
                  <label className="block">
                    <div className="text-xs text-muted-foreground mb-1">Delivery location</div>
                    <select
                      value={form.locationId}
                      onChange={(e) => setForm({ ...form, locationId: e.target.value })}
                      className="w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-gold/60"
                    >
                      <option value="">Select your area…</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}{l.area ? ` — ${l.area}` : ""} ({l.deliveryFee > 0 ? inr(l.deliveryFee) : "Free"})
                        </option>
                      ))}
                    </select>
                    {locations.length === 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">No delivery areas configured yet.</p>
                    )}
                  </label>
                </div>

                {/* Coupon — immediately before payment (spec #13) */}
                <div className="mt-5">
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground mb-2">Coupon</div>
                  {applied ? (
                    <div className="flex items-center justify-between gap-2 rounded-xl border border-forest/40 bg-forest/5 px-3 py-2.5 text-sm">
                      <span className="inline-flex items-center gap-2 text-forest">
                        <TicketPercent className="h-4 w-4" />
                        <strong className="font-mono">{applied.code}</strong> · {applied.label}
                      </span>
                      <button type="button" onClick={() => setApplied(null)} className="text-muted-foreground hover:text-destructive" aria-label="Remove coupon">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        placeholder="Coupon code"
                        className="flex-1 rounded-xl border border-input bg-background px-4 py-2.5 text-sm font-mono uppercase placeholder:font-sans placeholder:normal-case placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-gold/60"
                      />
                      <button
                        type="button"
                        onClick={applyCoupon}
                        disabled={couponBusy || !couponInput.trim()}
                        className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                      >
                        {couponBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="mt-5">
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground mb-2">Payment</div>
                  <div className="grid grid-cols-2 gap-2">
                    <PayOption active={form.method === "razorpay"} onClick={() => setForm({ ...form, method: "razorpay" })} icon={CreditCard} title="Pay online" sub="UPI · Cards · Wallets" />
                    <PayOption active={form.method === "cod"} onClick={() => setForm({ ...form, method: "cod" })} icon={Wallet} title="Cash on Delivery" sub="Pay at your doorstep" />
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-border bg-card p-6 shadow-soft">
                <h2 className="font-serif text-2xl text-foreground">Order summary</h2>
                <dl className="mt-4 space-y-2 text-sm">
                  <Row label="Subtotal" value={inr(subtotal)} />
                  {applied && <Row label={`Coupon (${applied.code})`} value={`- ${inr(couponDiscount)}`} green />}
                  <Row label="Delivery" value={subtotal > 0 ? (selectedLocation ? (deliveryFee > 0 ? inr(deliveryFee) : "Free") : "Select area") : "—"} />
                  <div className="h-px bg-border my-3" />
                  <Row label="Total" value={inr(total)} bold />
                </dl>

                <button
                  type="submit"
                  disabled={items.length === 0 || busy || !store.accepting}
                  className="mt-6 w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-elegant"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : form.method === "cod" ? <Wallet className="h-4 w-4" /> : <CreditCard className="h-4 w-4" />}
                  {!store.accepting ? "Ordering paused" : form.method === "cod" ? `Place order · ${inr(total)}` : `Pay ${inr(total)}`}
                </button>
                <p className="mt-3 text-xs text-muted-foreground text-center">
                  Payments are processed securely by Razorpay. Your card details never touch our servers.
                </p>
              </div>
            </form>
          </div>
        </div>
      </section>
      <Footer />
      <WhatsAppFab />
    </main>
  );
}

function PayOption({
  active,
  onClick,
  icon: Icon,
  title,
  sub,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-4 py-3 text-left transition-colors ${
        active ? "border-forest bg-forest/5" : "border-border hover:border-forest/40"
      }`}
    >
      <Icon className="h-4 w-4 text-forest" />
      <div className="mt-2 font-medium text-sm text-foreground">{title}</div>
      <div className="text-[11px] text-muted-foreground">{sub}</div>
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  const cls =
    "w-full rounded-xl border border-input bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-gold/60";
  return (
    <label className="block">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cls} />
    </label>
  );
}

function Row({ label, value, bold, green }: { label: string; value: string; bold?: boolean; green?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className={bold ? "font-serif text-lg text-foreground" : green ? "text-forest" : "text-muted-foreground"}>{label}</dt>
      <dd className={bold ? "font-serif text-lg text-foreground" : green ? "text-forest" : "text-foreground"}>{value}</dd>
    </div>
  );
}
