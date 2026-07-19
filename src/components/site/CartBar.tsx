"use client";

import { ShoppingBag, ArrowRight } from "lucide-react";
import { useCart } from "@/lib/cart";
import { inr } from "@/lib/utils";

export function CartBar() {
  const { count, subtotal, ready, openCart } = useCart();
  if (!ready || count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 sm:hidden">
      <button
        onClick={openCart}
        className="mx-3 mb-3 flex w-[calc(100%-1.5rem)] items-center justify-between gap-3 rounded-2xl bg-primary px-4 py-3 pr-20 text-left text-primary-foreground shadow-elegant"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative">
            <ShoppingBag className="h-6 w-6" />
            <span className="absolute -top-2 -right-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-charcoal">
              {count}
            </span>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">{inr(subtotal)}</div>
            <div className="text-[11px] text-primary-foreground/70">plus delivery</div>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-4 py-2 text-sm font-medium">
          View cart <ArrowRight className="h-4 w-4" />
        </span>
      </button>
    </div>
  );
}
