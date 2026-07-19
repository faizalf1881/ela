"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { X, Minus, Plus, Trash2, ShoppingBag, ArrowRight, Tag } from "lucide-react";
import { useCart } from "@/lib/cart";
import { inr } from "@/lib/utils";

const DELIVERY_FEE = 40;

export function CartSheet() {
  const router = useRouter();
  const { items, isOpen, closeCart, setQty, remove, subtotal, savings, count } = useCart();

  // Lock body scroll + close on Escape while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeCart();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, closeCart]);

  const total = subtotal + (subtotal > 0 ? DELIVERY_FEE : 0);

  const goCheckout = () => {
    closeCart();
    router.push("/checkout");
  };

  return (
    <>
      {/* Overlay */}
      <div
        onClick={closeCart}
        className={`fixed inset-0 z-[60] bg-charcoal/50 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!isOpen}
      />

      {/* Panel */}
      <aside
        className={`fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col bg-background shadow-elegant transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-label="Your cart"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <ShoppingBag className="h-5 w-5 text-forest" />
            <h2 className="font-serif text-xl text-foreground">Your cart</h2>
            {count > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{count}</span>}
          </div>
          <button onClick={closeCart} className="h-9 w-9 inline-flex items-center justify-center rounded-full hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-muted">
              <ShoppingBag className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">Your cart is empty.</p>
            <button onClick={closeCart} className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Browse the menu
            </button>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {items.map((i) => (
                <div key={i.id} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-muted">
                    <Image src={i.imageUrl || "/menu/traditional.jpg"} alt={i.name} fill sizes="56px" className="object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-foreground">{i.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {inr(i.price)}
                      {i.mrp && i.mrp > i.price && <span className="ml-1 line-through">{inr(i.mrp)}</span>}
                    </div>
                  </div>
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-primary p-1 text-primary-foreground">
                    <button onClick={() => setQty(i.id, i.qty - 1)} className="h-6 w-6 inline-flex items-center justify-center rounded-full hover:bg-white/15" aria-label="Decrease">
                      <Minus className="h-3 w-3" />
                    </button>
                    <span className="w-4 text-center text-xs font-semibold tabular-nums">{i.qty}</span>
                    <button onClick={() => setQty(i.id, i.qty + 1)} className="h-6 w-6 inline-flex items-center justify-center rounded-full hover:bg-white/15" aria-label="Increase">
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                  <button onClick={() => remove(i.id)} className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Remove">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="border-t border-border px-5 py-4">
              {savings > 0 && (
                <div className="mb-3 flex items-center gap-2 rounded-xl bg-forest/10 px-3 py-2 text-sm text-forest">
                  <Tag className="h-4 w-4" /> You&apos;re saving {inr(savings)} on this order
                </div>
              )}
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span>{inr(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Delivery</span>
                  <span>{inr(DELIVERY_FEE)}</span>
                </div>
                <div className="flex justify-between pt-1 font-serif text-lg text-foreground">
                  <span>Total</span>
                  <span>{inr(total)}</span>
                </div>
              </div>
              <button
                onClick={goCheckout}
                className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 shadow-elegant"
              >
                Proceed to checkout <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
