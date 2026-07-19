"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Power, Loader2 } from "lucide-react";

export function StoreToggle() {
  const [accepting, setAccepting] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAccepting(d.acceptingOrders))
      .catch(() => setAccepting(true));
  }, []);

  async function toggle() {
    if (accepting === null) return;
    const next = !accepting;
    setSaving(true);
    setAccepting(next);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptingOrders: next }),
      });
      if (!res.ok) throw new Error();
      toast.success(next ? "Store is now OPEN — accepting orders" : "Store CLOSED — orders paused");
    } catch {
      setAccepting(!next);
      toast.error("Could not update store status");
    } finally {
      setSaving(false);
    }
  }

  const open = accepting === true;

  return (
    <div
      className={`flex items-center justify-between gap-4 rounded-2xl border p-4 ${
        open ? "border-forest/30 bg-forest/5" : "border-destructive/40 bg-destructive/5"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${open ? "bg-forest/15 text-forest" : "bg-destructive/15 text-destructive"}`}>
          <Power className="h-5 w-5" />
        </div>
        <div>
          <div className="font-medium text-foreground">{accepting === null ? "Store status…" : open ? "Accepting orders" : "Not accepting orders"}</div>
          <div className="text-xs text-muted-foreground">
            {open ? "Customers can place orders." : "Customers see a “closed” message and can’t checkout."}
          </div>
        </div>
      </div>
      <button
        onClick={toggle}
        disabled={saving || accepting === null}
        role="switch"
        aria-checked={open}
        className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${open ? "bg-forest" : "bg-muted-foreground/40"}`}
      >
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full bg-white shadow transition-transform ${open ? "translate-x-7" : "translate-x-1"}`}>
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-forest" />}
        </span>
      </button>
    </div>
  );
}
