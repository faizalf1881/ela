"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingUp, ShoppingBag, Utensils, IndianRupee, TicketPercent, RefreshCw } from "lucide-react";
import { StaffShell } from "@/components/staff/StaffShell";
import { SalesBars, RankBars } from "@/components/staff/Charts";
import { inr } from "@/lib/utils";
import { STATUS_LABEL, STATUS_BADGE, type OrderStatus } from "@/lib/order-status";

type Analytics = {
  range: string;
  series: { label: string; revenue: number; orders: number }[];
  summary: { totalRevenue: number; totalOrders: number; itemsSold: number; avgOrder: number; totalSaved: number };
  topItems: { name: string; qty: number; revenue: number }[];
  statusCounts: Record<string, number>;
};

const RANGES = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
];

export default function AnalyticsPage() {
  const [range, setRange] = useState("daily");
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/analytics?range=${r}`, { cache: "no-store" });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range);
  }, [range, load]);

  const statuses: OrderStatus[] = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

  return (
    <StaffShell allow={["admin"]}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-serif text-3xl text-foreground">Analytics</h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full bg-muted p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-full px-4 py-1.5 text-sm transition-colors ${
                  range === r.key ? "bg-primary text-primary-foreground" : "text-foreground/80"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button onClick={() => load(range)} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-2 text-sm hover:bg-muted">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mt-6 grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Stat icon={IndianRupee} label="Revenue" value={data ? inr(data.summary.totalRevenue) : "—"} accent />
        <Stat icon={ShoppingBag} label="Orders" value={data ? String(data.summary.totalOrders) : "—"} />
        <Stat icon={Utensils} label="Items sold" value={data ? String(data.summary.itemsSold) : "—"} />
        <Stat icon={TrendingUp} label="Avg order" value={data ? inr(data.summary.avgOrder) : "—"} />
        <Stat icon={TicketPercent} label="Discounts given" value={data ? inr(data.summary.totalSaved) : "—"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        {/* Sales chart */}
        <div className="lg:col-span-3 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 className="font-serif text-xl text-foreground">
            Sales — {RANGES.find((r) => r.key === range)?.label.toLowerCase()}
          </h2>
          <p className="text-xs text-muted-foreground">Revenue per {range === "monthly" ? "month" : range === "weekly" ? "week" : "day"}</p>
          <div className="mt-6">{data ? <SalesBars data={data.series} /> : <div className="h-56" />}</div>
        </div>

        {/* Top items */}
        <div className="lg:col-span-2 rounded-2xl border border-border bg-card p-6 shadow-soft">
          <h2 className="font-serif text-xl text-foreground">Best &amp; least sellers</h2>
          <p className="text-xs text-muted-foreground">By quantity in this period</p>
          <div className="mt-6">{data && <RankBars items={data.topItems} />}</div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="mt-6 rounded-2xl border border-border bg-card p-6 shadow-soft">
        <h2 className="font-serif text-xl text-foreground">Orders by status (all time)</h2>
        <div className="mt-4 flex flex-wrap gap-3">
          {statuses.map((st) => (
            <div key={st} className="flex items-center gap-2 rounded-full border border-border px-4 py-2">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[st]}`}>{STATUS_LABEL[st]}</span>
              <span className="font-serif text-lg text-foreground tabular-nums">{data?.statusCounts[st] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </StaffShell>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-2xl border p-5 ${accent ? "border-forest/30 bg-forest/5" : "border-border bg-card"}`}>
      <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-forest/10 text-forest">
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-3 font-serif text-2xl text-foreground tabular-nums">{value}</div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}
