"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CreditCard, Loader2, Check, Copy, CircleAlert } from "lucide-react";

type Payments = {
  preference: "AUTO" | "CASHFREE" | "RAZORPAY";
  active: "cashfree" | "razorpay" | null;
  activeLabel: string | null;
  cashfree: { configured: boolean; mode: "sandbox" | "production" };
  razorpay: { configured: boolean };
  webhooks: { cashfree: string; razorpay: string };
};

const CHOICES: { key: Payments["preference"]; title: string; sub: string }[] = [
  { key: "AUTO", title: "Automatic", sub: "Cashfree when its keys are set, otherwise Razorpay" },
  { key: "CASHFREE", title: "Cashfree", sub: "Website checkout and WhatsApp payment links" },
  { key: "RAZORPAY", title: "Razorpay", sub: "Website checkout and WhatsApp payment links" },
];

/** Which gateway takes online payments (website + WhatsApp links). Keys stay in Vercel env vars. */
export function PaymentSettings() {
  const [cfg, setCfg] = useState<Payments | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCfg(d.payments))
      .catch(() => toast.error("Could not load payment settings"));
  }, []);

  async function choose(pref: Payments["preference"]) {
    setBusy(pref);
    try {
      const res = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentGateway: pref }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save");
      setCfg(d.payments);
      if (d.payments.active) toast.success(`Online payments now go through ${d.payments.activeLabel}`);
      else toast.error("That gateway isn't set up yet — online payment is unavailable until its keys are added.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div id="payments" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-forest/15 text-forest">
          <CreditCard className="h-5 w-5" />
        </div>
        <div>
          <div className="font-medium text-foreground">Payments</div>
          <div className="text-xs text-muted-foreground">The gateway for online orders and WhatsApp payment links.</div>
        </div>
      </div>

      {!cfg ? (
        <div className="mt-5 h-40 animate-pulse rounded-xl bg-muted" />
      ) : (
        <div className="mt-5 space-y-4">
          <div className={`rounded-xl px-3 py-2.5 text-sm ${cfg.active ? "bg-forest/10 text-foreground" : "bg-destructive/10 text-destructive"}`}>
            {cfg.active ? (
              <>
                Online payments go through <strong>{cfg.activeLabel}</strong>
                {cfg.active === "cashfree" && cfg.cashfree.mode === "sandbox" ? " (TEST mode — no real money)" : ""}.
              </>
            ) : (
              <span className="inline-flex items-start gap-1.5">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> No gateway is set up, so customers can only choose Cash on Delivery.
              </span>
            )}
          </div>

          <div className="grid gap-2">
            {CHOICES.map((c) => (
              <button
                key={c.key}
                onClick={() => choose(c.key)}
                disabled={busy !== null}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left disabled:opacity-70 ${cfg.preference === c.key ? "border-forest bg-forest/5" : "border-border hover:bg-muted"}`}
              >
                <span>
                  <span className="block text-sm font-medium text-foreground">{c.title}</span>
                  <span className="block text-xs text-muted-foreground">{c.sub}</span>
                </span>
                {busy === c.key ? <Loader2 className="h-4 w-4 animate-spin" /> : cfg.preference === c.key ? <Check className="h-4 w-4 text-forest" /> : null}
              </button>
            ))}
          </div>

          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <Status name="Cashfree" ok={cfg.cashfree.configured} detail={cfg.cashfree.configured ? (cfg.cashfree.mode === "sandbox" ? "Test keys" : "Live keys") : "Add CASHFREE_APP_ID and CASHFREE_SECRET_KEY in Vercel"} />
            <Status name="Razorpay" ok={cfg.razorpay.configured} detail={cfg.razorpay.configured ? "Keys set · also used for memberships" : "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET"} />
          </div>

          <div className="text-xs text-muted-foreground">
            Cashfree confirms each payment to this address automatically. To also see it in the Cashfree dashboard (Developers → Webhooks), add:
            <CopyLine value={cfg.webhooks.cashfree} />
          </div>
          <p className="text-[11px] text-muted-foreground">Memberships with AutoPay keep using Razorpay — existing mandates can&apos;t be moved to another gateway.</p>
        </div>
      )}
    </div>
  );
}

function Status({ name, ok, detail }: { name: string; ok: boolean; detail: string }) {
  return (
    <div className="rounded-xl border border-border px-3 py-2">
      <div className="flex items-center gap-1.5 font-medium text-foreground">
        <span className={`h-2 w-2 rounded-full ${ok ? "bg-green-600" : "bg-muted-foreground/40"}`} /> {name}
      </div>
      <div className="mt-0.5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function CopyLine({ value }: { value: string }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success("Copied"), () => {})}
      className="mt-1 flex w-full items-center justify-between gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-left font-mono text-[11px] text-foreground hover:bg-secondary"
    >
      <span className="truncate">{value}</span>
      <Copy className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}
