"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck, XCircle, MapPin, CalendarClock, RefreshCw } from "lucide-react";
import { BrandLogo } from "./BrandLogo";
import { WhatsAppGlyph } from "./WhatsAppGlyph";
import { inr } from "@/lib/utils";
import { cashfreeCheckout, loadRazorpay, type RazorpayResponse } from "@/lib/gateway-client";
import type { PaymentStart } from "@/lib/payments";

export type PayOrder = {
  id: string;
  ref: string;
  customerName: string;
  items: { name: string; qty: number; price: number }[];
  subtotal: number;
  savings: number;
  deliveryFee: number;
  total: number;
  amountDue: number;
  codBalanceDue: number;
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID" | "FAILED" | "REFUNDED";
  status: string;
  delivery: string | null;
  address: string;
};

const WA = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "917907577979";

/** The payment-link page: order summary, one Pay button, and the gateway's verdict. */
export function PayView({ order, token, blocker, gatewayLabel }: { order: PayOrder | null; token: string; blocker: string | null; gatewayLabel: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [justPaid, setJustPaid] = useState(false);

  async function confirm(extra: Partial<RazorpayResponse> = {}) {
    const res = await fetch(`/api/pay/${order!.id}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: token, ...extra }) });
    const d = await res.json().catch(() => ({}));
    if (d.paid) {
      setJustPaid(true);
      router.refresh();
      return;
    }
    if (d.status === "FAILED") toast.error("The payment didn't go through. You can try again.");
    else if (d.error) toast.message("Confirming your payment…", { description: d.error });
    else toast.message("Payment not completed", { description: "Tap Pay to try again." });
  }

  async function pay() {
    if (!order) return;
    setBusy(true);
    let waiting = false;
    try {
      const res = await fetch(`/api/pay/${order.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ k: token }) });
      const d = await res.json();
      if (!res.ok) {
        if (d.paid) {
          router.refresh();
          return;
        }
        throw new Error(d.error || "Could not open the payment page");
      }
      const start = d as PaymentStart & { prefill: { name: string; contact: string } };
      if (start.gateway === "cashfree") {
        const result = await cashfreeCheckout(start.cashfree.paymentSessionId, start.cashfree.mode);
        if (result.redirect) {
          waiting = true; // the browser is moving to Cashfree and back to this page
          return;
        }
        await confirm();
        return;
      }
      const ok = await loadRazorpay();
      if (!ok || !window.Razorpay) throw new Error("Could not load the payment page");
      waiting = true;
      const rzp = new window.Razorpay({
        key: start.razorpay.keyId,
        amount: start.razorpay.amount,
        currency: start.razorpay.currency,
        name: "Ela & Co.",
        description: `Order ${order.ref}`,
        image: `${window.location.origin}/brand/ela-logo.png`,
        order_id: start.razorpay.orderId,
        prefill: start.prefill,
        theme: { color: "#4B5A24" },
        handler: async (response: RazorpayResponse) => {
          try {
            await confirm(response);
          } finally {
            setBusy(false);
          }
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      rzp.on("payment.failed", (resp: unknown) => {
        const desc = (resp as { error?: { description?: string } })?.error?.description;
        toast.error(desc || "Payment failed. Please try again.");
      });
      rzp.open();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      if (!waiting) setBusy(false);
    }
  }

  const paid = order && (order.paymentStatus === "PAID" || order.paymentStatus === "PARTIAL");

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-lg px-4 py-8 sm:py-14">
        <div className="flex items-center justify-center gap-3">
          <BrandLogo size={44} priority />
          <div className="leading-tight">
            <div className="font-serif text-xl text-foreground">Ela &amp; Co.</div>
            <div className="text-[10px] uppercase tracking-[0.28em] text-gold">Secure payment</div>
          </div>
        </div>

        {!order ? (
          <div className="mt-8 rounded-3xl border border-border bg-card p-6 text-center shadow-soft">
            <XCircle className="mx-auto h-10 w-10 text-destructive" />
            <h1 className="mt-3 font-serif text-2xl text-foreground">This payment link isn&apos;t valid</h1>
            <p className="mt-2 text-sm text-muted-foreground">Please use the latest link we sent you on WhatsApp, or message us for a new one.</p>
            <WaButton />
          </div>
        ) : (
          <div className="mt-8 rounded-3xl border border-border bg-card p-5 shadow-soft sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.25em] text-gold">Order {order.ref}</div>
                <h1 className="mt-1 font-serif text-2xl text-foreground">{order.customerName}</h1>
              </div>
              <span className="font-serif text-2xl text-foreground tabular-nums">{inr(order.total)}</span>
            </div>

            <div className="mt-4 space-y-1.5 border-t border-border pt-4 text-sm">
              {order.items.map((i, n) => (
                <div key={n} className="flex justify-between gap-3 text-foreground/90">
                  <span>
                    {i.qty}× {i.name}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{inr(i.price * i.qty)}</span>
                </div>
              ))}
              <div className="mt-2 space-y-1 border-t border-dashed border-border pt-2 text-muted-foreground">
                <Row label="Subtotal" value={inr(order.subtotal)} />
                {order.savings > 0 && <Row label="Discounts" value={`− ${inr(order.savings)}`} />}
                <Row label="Delivery" value={order.deliveryFee > 0 ? inr(order.deliveryFee) : "Free"} />
                <div className="flex justify-between font-medium text-foreground">
                  <span>Total</span>
                  <span className="tabular-nums">{inr(order.total)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
              {order.delivery && (
                <div className="flex items-start gap-2">
                  <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> {order.delivery}
                </div>
              )}
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> {order.address}
              </div>
            </div>

            <div className="mt-6">
              {paid || justPaid ? (
                <div className="rounded-2xl bg-forest/10 p-4 text-center">
                  <CheckCircle2 className="mx-auto h-9 w-9 text-forest" />
                  <div className="mt-2 font-medium text-foreground">Payment received — your order is confirmed</div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {order.codBalanceDue > 0 ? `${inr(order.codBalanceDue)} is due in cash on delivery. ` : ""}We&apos;ve sent the confirmation to your WhatsApp.
                  </p>
                  <WaButton label="Back to WhatsApp" />
                </div>
              ) : order.paymentStatus === "REFUNDED" ? (
                <Notice text="This order was refunded." />
              ) : order.status === "CANCELLED" ? (
                <Notice text="This order was cancelled. Message us on WhatsApp if you need help." />
              ) : blocker ? (
                <Notice text={blocker} />
              ) : !gatewayLabel ? (
                <Notice text="Online payment isn't available right now. Please try again later or message us on WhatsApp." />
              ) : (
                <>
                  {order.codBalanceDue > 0 && (
                    <p className="mb-3 rounded-xl bg-gold/10 px-3 py-2 text-xs text-foreground">
                      Pay <strong>{inr(order.amountDue)}</strong> now to confirm. The remaining <strong>{inr(order.codBalanceDue)}</strong> is paid in cash on delivery.
                    </p>
                  )}
                  <button
                    onClick={pay}
                    disabled={busy}
                    data-pay-amount={order.amountDue}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-primary px-6 py-3 text-base font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />} Pay {inr(order.amountDue)}
                  </button>
                  {order.paymentStatus === "FAILED" && <p className="mt-2 text-center text-xs text-destructive">The last attempt didn&apos;t go through — you can try again.</p>}
                  <button onClick={() => router.refresh()} className="mx-auto mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                    <RefreshCw className="h-3.5 w-3.5" /> Already paid? Check again
                  </button>
                  <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                    <ShieldCheck className="h-3.5 w-3.5" /> Processed securely by {gatewayLabel}. We never see your card or UPI PIN.
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-muted p-4 text-center text-sm text-foreground">
      {text}
      <WaButton />
    </div>
  );
}

function WaButton({ label = "Message us on WhatsApp" }: { label?: string }) {
  return (
    <a href={`https://wa.me/${WA}`} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#25D366] px-5 py-2.5 text-sm font-medium text-white hover:bg-[#1fb957]">
      <WhatsAppGlyph className="h-4 w-4" /> {label}
    </a>
  );
}
