"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Search, ChevronDown, User, Shield, ChefHat, Cog } from "lucide-react";
import { StaffShell } from "@/components/staff/StaffShell";

type Log = {
  id: string;
  createdAt: string;
  actorType: string;
  actorLabel: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string | null;
  metadata: unknown;
  ip: string | null;
};

const PAGE = 50;

function actorIcon(t: string) {
  if (t === "admin") return Shield;
  if (t === "kitchen") return ChefHat;
  if (t === "customer") return User;
  return Cog;
}

function actionColor(a: string) {
  if (a.includes("failed") || a.includes("deleted") || a.includes("payment_failed")) return "bg-destructive/10 text-destructive";
  if (a.startsWith("order.paid") || a.includes("created") || a.includes("login")) return "bg-forest/10 text-forest";
  if (a.includes("status_changed") || a.includes("updated") || a.includes("settings")) return "bg-gold/15 text-[oklch(0.52_0.12_75)]";
  return "bg-muted text-muted-foreground";
}

export default function AuditPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(
    async (reset: boolean) => {
      setLoading(true);
      const off = reset ? 0 : offset;
      const params = new URLSearchParams({ limit: String(PAGE), offset: String(off) });
      if (action) params.set("action", action);
      if (q) params.set("q", q);
      try {
        const res = await fetch(`/api/admin/audit?${params}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setLogs((prev) => (reset ? data.logs : [...prev, ...data.logs]));
          setTotal(data.total);
          setActions(data.actions);
          setOffset(off + data.logs.length);
        }
      } finally {
        setLoading(false);
      }
    },
    [action, q, offset],
  );

  // Reload from scratch when filters change.
  useEffect(() => {
    setOffset(0);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action]);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <StaffShell allow={["admin"]}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Audit log</h1>
          <p className="text-sm text-muted-foreground">{total} recorded events · who did what, and when.</p>
        </div>
        <button onClick={() => { setOffset(0); load(true); }} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      <div className="mt-5 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (setOffset(0), load(true))}
            placeholder="Search summary, actor, id…"
            className="w-full rounded-full border border-input bg-background pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
          />
        </div>
        <select value={action} onChange={(e) => setAction(e.target.value)} className="rounded-full border border-input bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60">
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
        {logs.length === 0 && !loading ? (
          <div className="p-10 text-center text-muted-foreground">No audit events found.</div>
        ) : (
          <ul className="divide-y divide-border">
            {logs.map((l) => {
              const Icon = actorIcon(l.actorType);
              const open = expanded === l.id;
              return (
                <li key={l.id}>
                  <button onClick={() => setExpanded(open ? null : l.id)} className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40">
                    <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground/70">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${actionColor(l.action)}`}>{l.action}</span>
                        <span className="text-sm text-foreground">{l.summary}</span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {new Date(l.createdAt).toLocaleString("en-IN")} · {l.actorType}
                        {l.actorLabel ? ` (${l.actorLabel})` : ""}{l.ip ? ` · ${l.ip}` : ""}
                      </div>
                    </div>
                    {l.metadata != null && <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />}
                  </button>
                  {open && l.metadata != null && (
                    <pre className="mx-4 mb-3 overflow-x-auto rounded-xl bg-muted p-3 text-xs text-foreground/80">{JSON.stringify(l.metadata, null, 2)}</pre>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {offset < total && (
        <div className="mt-4 text-center">
          <button onClick={() => load(false)} disabled={loading} className="rounded-full border border-border px-6 py-2.5 text-sm hover:bg-muted disabled:opacity-60">
            {loading ? "Loading…" : `Load more (${total - offset} left)`}
          </button>
        </div>
      )}
    </StaffShell>
  );
}
