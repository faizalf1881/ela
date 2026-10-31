"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShoppingBag, Loader2, CheckCircle2, CircleAlert } from "lucide-react";

type Ordering = {
  enabled: boolean;
  checks: { whatsapp: boolean; ai: boolean; aiNote: string; payments: string | null; cod: boolean; locations: number; accepting: boolean };
};

/** Ordering on WhatsApp (spec #8–#14): on/off, and whether everything it needs is in place. */
export function WhatsAppOrderingSettings() {
  const [cfg, setCfg] = useState<Ordering | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCfg(d.ordering))
      .catch(() => toast.error("Could not load WhatsApp ordering settings"));
  }, []);

  async function toggle() {
    if (!cfg) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ waOrderingEnabled: !cfg.enabled }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save");
      setCfg(d.ordering);
      toast.success(d.ordering.enabled ? "Customers can order on WhatsApp" : "WhatsApp ordering is off — the assistant only answers questions");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  const c = cfg?.checks;
  const rows = c
    ? [
        { ok: c.whatsapp, text: c.whatsapp ? "WhatsApp is connected" : "WhatsApp isn't connected (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)" },
        { ok: c.ai, text: c.ai ? `AI assistant on (${c.aiNote}) — understands typed requests` : "AI assistant is off — taps and the word “menu” still work; typed questions wait for staff" },
        { ok: !!c.payments || c.cod, text: c.payments ? `Payment links via ${c.payments}${c.cod ? " · cash on delivery too" : ""}` : c.cod ? "No online gateway — cash on delivery only" : "No way to pay: set up a gateway or turn on cash on delivery" },
        { ok: c.locations > 0, text: c.locations > 0 ? `${c.locations} delivery area${c.locations === 1 ? "" : "s"}` : "Add a delivery area in Locations" },
        { ok: c.accepting, text: c.accepting ? "Store is taking orders" : "Store is closed — customers are told it's paused" },
      ]
    : [];

  return (
    <div id="ordering" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-forest/15 text-forest">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">WhatsApp ordering</div>
            <div className="text-xs text-muted-foreground">Menu, cart, checkout and payment link — all inside WhatsApp.</div>
          </div>
        </div>
        {cfg && (
          <button
            onClick={toggle}
            disabled={busy}
            role="switch"
            aria-checked={cfg.enabled}
            aria-label="WhatsApp ordering"
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${cfg.enabled ? "bg-forest" : "bg-muted-foreground/30"}`}
          >
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${cfg.enabled ? "translate-x-6" : "translate-x-1"}`} />
            {busy && <Loader2 className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />}
          </button>
        )}
      </div>
      {!cfg ? (
        <div className="mt-5 h-28 animate-pulse rounded-xl bg-muted" />
      ) : (
        <ul className="mt-4 space-y-1.5 text-xs">
          {rows.map((r) => (
            <li key={r.text} className={`flex items-start gap-2 ${r.ok ? "text-foreground" : "text-destructive"}`}>
              {r.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />} {r.text}
            </li>
          ))}
          <li className="pt-1 text-muted-foreground">Prices, dishes and stock always come from Menu; delivery fees from Locations; times from Schedule.</li>
        </ul>
      )}
    </div>
  );
}
