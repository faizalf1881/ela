"use client";

import { inr } from "@/lib/utils";

type Point = { label: string; revenue: number; orders: number };

/** Responsive vertical bar chart (CSS-based, no dependencies). */
export function SalesBars({ data }: { data: Point[] }) {
  const max = Math.max(1, ...data.map((d) => d.revenue));
  return (
    <div>
      <div className="flex items-end gap-1.5 h-56">
        {data.map((d, i) => {
          const pct = (d.revenue / max) * 100;
          return (
            <div key={i} className="group relative flex-1 flex flex-col items-center justify-end gap-2 min-w-0">
              <div className="pointer-events-none absolute -top-1 z-10 hidden -translate-y-full rounded-lg bg-charcoal px-2 py-1 text-[11px] text-ivory shadow-soft group-hover:block whitespace-nowrap">
                {inr(d.revenue)} · {d.orders} order{d.orders === 1 ? "" : "s"}
              </div>
              <div className="w-full flex items-end h-full">
                <div
                  className="w-full rounded-t-md bg-gradient-to-t from-forest to-forest/60 transition-all group-hover:from-gold group-hover:to-gold/70"
                  style={{ height: `${Math.max(pct, d.revenue > 0 ? 4 : 0)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1.5">
        {data.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[9px] leading-tight text-muted-foreground truncate">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal ranking bars — best sellers at top, worst at bottom. */
export function RankBars({ items }: { items: { name: string; qty: number; revenue: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.qty));
  if (items.length === 0) return <div className="text-sm text-muted-foreground">No sales yet.</div>;
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={it.name}>
          <div className="flex items-center justify-between text-sm">
            <span className="text-foreground truncate pr-2">
              <span className="text-muted-foreground mr-1.5">{i + 1}.</span>
              {it.name}
            </span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {it.qty} sold · {inr(it.revenue)}
            </span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-gold to-[oklch(0.68_0.13_65)]"
              style={{ width: `${(it.qty / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
