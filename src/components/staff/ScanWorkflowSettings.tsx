"use client";

import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { ScanLine, Loader2, ChevronRight, Check } from "lucide-react";
import { STATUS_LABEL, type OrderStatus } from "@/lib/order-status";

const FLOW: OrderStatus[] = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED"];
// The first and last steps are fixed; the kitchen may skip the middle ones.
const OPTIONAL = new Set<OrderStatus>(["PREPARING", "OUT_FOR_DELIVERY"]);

/**
 * Admin control for the QR-scan workflow (spec #38): which steps a delivery-label
 * scan walks an order through.
 */
export function ScanWorkflowSettings() {
  const [steps, setSteps] = useState<OrderStatus[] | null>(null);
  const [busy, setBusy] = useState<OrderStatus | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setSteps(d.scanSteps || FLOW))
      .catch(() => setSteps(FLOW));
  }, []);

  async function toggle(step: OrderStatus) {
    if (!steps || !OPTIONAL.has(step)) return;
    const next = steps.includes(step) ? steps.filter((s) => s !== step) : FLOW.filter((s) => s === step || steps.includes(s));
    setBusy(step);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanSteps: next }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save");
      setSteps(d.scanSteps);
      toast.success("Scan workflow updated");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-forest/15 text-forest">
          <ScanLine className="h-5 w-5" />
        </div>
        <div>
          <div className="font-medium text-foreground">QR scan workflow</div>
          <div className="text-xs text-muted-foreground">Each label scan moves the order one step along this path.</div>
        </div>
      </div>

      {!steps ? (
        <div className="mt-5 h-12 animate-pulse rounded-xl bg-muted" />
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-1.5">
          {FLOW.map((st, i) => {
            const on = steps.includes(st);
            const optional = OPTIONAL.has(st);
            return (
              <Fragment key={st}>
                {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <button
                  type="button"
                  onClick={() => toggle(st)}
                  disabled={!optional || busy !== null}
                  aria-pressed={on}
                  title={optional ? (on ? "Click to skip this step when scanning" : "Click to include this step") : "Always part of the workflow"}
                  className={`inline-flex min-h-10 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm transition-colors ${
                    !optional
                      ? "bg-forest/10 text-forest ring-1 ring-forest/20 cursor-default"
                      : on
                        ? "bg-forest text-white cursor-pointer hover:opacity-90"
                        : "border border-dashed border-muted-foreground/50 text-muted-foreground line-through cursor-pointer hover:border-forest/50"
                  }`}
                >
                  {busy === st ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : optional && on && <Check className="h-3.5 w-3.5" />}
                  {STATUS_LABEL[st]}
                </button>
              </Fragment>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground leading-relaxed">
        Tap <strong>Preparing</strong> or <strong>Out for delivery</strong> to skip or include it. Delivered is final, and
        cancelled or unpaid orders can&apos;t be moved by scanning. A label read twice within a few seconds counts once.
      </p>
    </div>
  );
}
