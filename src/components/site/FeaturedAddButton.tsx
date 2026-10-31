"use client";

import { Plus, Check } from "lucide-react";
import { toast } from "sonner";
import { useCart } from "@/lib/cart";
import type { FeaturedDish } from "@/lib/site-content";

/** "Add to order" on the homepage dish card — the same cart as the menu below. */
export function FeaturedAddButton({ dish }: { dish: FeaturedDish }) {
  const { add, items } = useCart();
  const qty = items.find((c) => c.id === dish.id)?.qty ?? 0;
  const atMax = dish.stock !== null && qty >= dish.stock;

  return (
    <button
      onClick={() => {
        if (atMax) return toast.error(`Only ${dish.stock} available`);
        add({ id: dish.id, name: dish.name, price: dish.price, mrp: dish.mrp, imageUrl: dish.imageUrl });
        toast.success(`${dish.name} added`);
      }}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
    >
      {qty > 0 ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
      {qty > 0 ? `In your order (${qty}) · add another` : "Add to order"}
    </button>
  );
}
