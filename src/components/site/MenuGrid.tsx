"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Plus, Minus, Flame, Search } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/lib/cart";
import { inr, isVeg } from "@/lib/utils";
import { effectivePrice } from "@/lib/pricing";

export type MenuCardItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  discountPercent: number;
  tag: string | null;
  spice: number;
  imageUrl: string | null;
  category: string;
  stock: number | null;
};

export function MenuGrid({ items, accepting = true }: { items: MenuCardItem[]; accepting?: boolean }) {
  const { add, setQty, items: cart } = useCart();
  const [cat, setCat] = useState("All");
  const [q, setQ] = useState("");

  const categories = useMemo(() => ["All", ...Array.from(new Set(items.map((i) => i.category)))], [items]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter(
      (i) =>
        (cat === "All" || i.category === cat) &&
        (!query || i.name.toLowerCase().includes(query) || i.description.toLowerCase().includes(query)),
    );
  }, [items, cat, q]);

  const qtyOf = (id: string) => cart.find((c) => c.id === id)?.qty ?? 0;

  return (
    <section id="menu" className="relative py-14 sm:py-28 bg-secondary/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4 sm:gap-6 mb-5 sm:mb-8">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-[0.3em] text-gold">Our Menu</div>
            <h2 className="mt-2 sm:mt-3 font-serif text-3xl sm:text-5xl text-foreground text-balance">Plated on banana leaf.</h2>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search dishes…"
              className="w-full rounded-full border border-input bg-background pl-9 pr-4 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
          </div>
        </div>

        {/* Category tabs — one swipeable row on phones, wrapping from sm up. */}
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:mb-8 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`shrink-0 rounded-full px-4 py-2 sm:py-1.5 text-sm transition-colors ${
                cat === c ? "bg-primary text-primary-foreground" : "bg-card ring-1 ring-border text-foreground/80 hover:bg-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
            {items.length === 0 ? "The menu is being prepared. Please check back soon." : "No dishes match your search."}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {filtered.map((m) => {
              const eff = effectivePrice(m.price, m.discountPercent);
              const soldOut = m.stock !== null && m.stock <= 0;
              const qty = qtyOf(m.id);
              const atMax = m.stock !== null && qty >= m.stock;
              const lowStock = m.stock !== null && m.stock > 0 && m.stock <= 5;

              return (
                <article
                  key={m.id}
                  className="group relative flex flex-row sm:flex-col rounded-2xl sm:rounded-3xl overflow-hidden bg-card shadow-soft ring-1 ring-border hover:shadow-elegant transition-all duration-500"
                >
                  <div className="relative w-28 shrink-0 self-stretch overflow-hidden min-h-32 sm:w-auto sm:min-h-0 sm:aspect-[4/3]">
                    <Image
                      src={m.imageUrl || "/menu/traditional.jpg"}
                      alt={m.name}
                      fill
                      sizes="(max-width: 640px) 112px, (max-width: 1024px) 50vw, 33vw"
                      className={`object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-105 ${soldOut ? "grayscale" : ""}`}
                    />
                    {m.discountPercent > 0 && !soldOut && (
                      <div className="absolute top-2 left-2 rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold text-charcoal shadow-soft sm:top-4 sm:left-4 sm:px-2.5 sm:py-1 sm:text-[11px]">
                        {m.discountPercent}% OFF
                      </div>
                    )}
                    {m.tag && !soldOut && (
                      <div className="absolute top-4 right-4 hidden items-center gap-1.5 rounded-full glass px-3 py-1 text-[11px] uppercase tracking-widest text-foreground sm:inline-flex">
                        {m.tag}
                      </div>
                    )}
                    {soldOut && (
                      <div className="absolute inset-0 flex items-center justify-center bg-charcoal/40">
                        <span className="rounded-full bg-charcoal px-2.5 py-1 text-xs font-medium text-ivory sm:px-4 sm:py-1.5 sm:text-sm">Stock Out</span>
                      </div>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col p-3.5 sm:p-6">
                    <div className="flex items-start justify-between gap-2 sm:gap-3">
                      <div className="min-w-0">
                        <div className="flex items-start gap-2">
                          <span className="mt-1.5 sm:mt-2">
                            <VegDot veg={isVeg(m.category, m.name)} />
                          </span>
                          <h3 className="font-serif text-xl leading-tight text-foreground sm:text-2xl">{m.name}</h3>
                        </div>
                        <div className="mt-1 flex items-center gap-1">
                          {Array.from({ length: 3 }).map((_, s) => (
                            <Flame key={s} className={`h-3 w-3 ${s < m.spice ? "text-gold" : "text-muted-foreground/30"}`} />
                          ))}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-lg font-semibold tabular-nums text-foreground sm:font-serif sm:text-2xl sm:font-normal">{inr(eff)}</div>
                        {m.discountPercent > 0 && <div className="text-xs text-muted-foreground line-through">{inr(m.price)}</div>}
                      </div>
                    </div>
                    <p className="mt-1.5 line-clamp-2 flex-1 text-[13px] leading-snug text-muted-foreground sm:mt-2 sm:line-clamp-none sm:text-sm sm:leading-relaxed">
                      {m.description}
                    </p>

                    <div className="mt-3 flex items-center justify-between gap-2 sm:mt-5">
                      <div className="min-w-0 text-xs text-muted-foreground">
                        {lowStock ? (
                          <span className="text-gold">Only {m.stock} left</span>
                        ) : (
                          <span className="hidden sm:inline">Freshly prepared · 30–45 min</span>
                        )}
                      </div>

                      {soldOut || !accepting ? (
                        <button disabled className="min-h-10 rounded-full bg-muted px-4 py-2 text-xs font-medium text-muted-foreground cursor-not-allowed">
                          {accepting ? "Stock Out" : "Closed"}
                        </button>
                      ) : qty === 0 ? (
                        <button
                          onClick={() => {
                            add({ id: m.id, name: m.name, price: eff, mrp: m.price, imageUrl: m.imageUrl });
                            toast.success(`${m.name} added`);
                          }}
                          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors sm:min-h-0 sm:px-4 sm:text-xs"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                      ) : (
                        <div className="inline-flex items-center gap-2 rounded-full bg-primary p-1 text-primary-foreground">
                          <button onClick={() => setQty(m.id, qty - 1)} className="h-10 w-10 sm:h-7 sm:w-7 inline-flex items-center justify-center rounded-full hover:bg-white/15" aria-label="Decrease">
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-5 text-center text-sm font-semibold tabular-nums">{qty}</span>
                          <button
                            onClick={() => (atMax ? toast.error(`Only ${m.stock} available`) : setQty(m.id, qty + 1))}
                            className="h-10 w-10 sm:h-7 sm:w-7 inline-flex items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-50"
                            aria-label="Increase"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function VegDot({ veg }: { veg: boolean }) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ${veg ? "border-green-600" : "border-red-600"}`}
      title={veg ? "Veg" : "Non-veg"}
    >
      <span className={`h-2 w-2 rounded-full ${veg ? "bg-green-600" : "bg-red-600"}`} />
    </span>
  );
}
