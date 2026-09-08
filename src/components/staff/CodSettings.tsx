"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Wallet, Loader2, Save } from "lucide-react";
import { inr } from "@/lib/utils";

/**
 * Cash on Delivery controls: availability, plus an optional confirmation amount
 * collected online up front to cut down refused / return-to-origin deliveries.
 */
export function CodSettings() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("0");
  const [savedAmount, setSavedAmount] = useState("0");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setEnabled(d.codEnabled ?? true);
        setAmount(String(d.codConfirmAmount ?? 0));
        setSavedAmount(String(d.codConfirmAmount ?? 0));
      })
      .catch(() => setEnabled(true));
  }, []);

  async function patch(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      toast.success(ok);
      return true;
    } catch {
      toast.error("Could not save");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    if (enabled === null) return;
    const next = !enabled;
    setEnabled(next);
    const ok = await patch({ codEnabled: next }, next ? "Cash on Delivery is ON" : "Cash on Delivery is OFF");
    if (!ok) setEnabled(!next);
  }

  async function saveAmount() {
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 0) return toast.error("Enter a whole rupee amount");
    const ok = await patch({ codConfirmAmount: n }, n > 0 ? `Confirmation amount set to ${inr(n)}` : "Confirmation amount removed");
    if (ok) setSavedAmount(String(n));
  }

  const on = enabled === true;
  const dirty = amount !== savedAmount;

  return (
    <div className={`rounded-2xl border p-4 ${on ? "border-border bg-card" : "border-dashed border-border bg-card"}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${on ? "bg-forest/15 text-forest" : "bg-muted text-muted-foreground"}`}>
            <Wallet className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">{enabled === null ? "Cash on Delivery…" : on ? "Cash on Delivery: ON" : "Cash on Delivery: OFF"}</div>
            <div className="text-xs text-muted-foreground">
              {on ? "Customers can choose to pay at the door." : "Only online payment is offered at checkout."}
            </div>
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={busy || enabled === null}
          role="switch"
          aria-checked={on}
          aria-label="Toggle Cash on Delivery"
          className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-forest" : "bg-muted-foreground/40"}`}
        >
          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform ${on ? "translate-x-7" : "translate-x-1"}`}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-forest" />}
          </span>
        </button>
      </div>

      {on && (
        <div className="mt-4 border-t border-border pt-4">
          <label className="block">
            <span className="text-xs text-muted-foreground">Confirmation amount collected online (₹) — 0 to disable</span>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-32 rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
              />
              <button
                onClick={saveAmount}
                disabled={busy || !dirty}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
              </button>
            </div>
          </label>
          <p className="mt-2 text-xs text-muted-foreground">
            {Number(savedAmount) > 0
              ? `COD customers pay ${inr(Number(savedAmount))} online to confirm; the rest is collected in cash on delivery. This reduces refused deliveries.`
              : "COD orders are placed without any up-front payment."}
          </p>
        </div>
      )}
    </div>
  );
}
