"use client";

import { useCart } from "@/lib/cart";
import { WhatsAppGlyph } from "./WhatsAppGlyph";

const WA = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "917907577979";

/**
 * Floating "chat on WhatsApp" button. On phones it is smaller and never sits on
 * top of the page's own bottom bar:
 *   - "above-cart": lifts above the floating cart bar while the cart has items
 *   - "hidden":     not shown on phones (pages with their own sticky action bar)
 */
export function WhatsAppFab({ mobile = "default" }: { mobile?: "default" | "above-cart" | "hidden" }) {
  const { count, ready } = useCart();
  const lifted = mobile === "above-cart" && ready && count > 0;

  return (
    <a
      href={`https://wa.me/${WA}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat on WhatsApp"
      className={`group fixed right-4 z-40 h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-elegant transition-[transform,bottom] hover:scale-110 sm:right-6 sm:bottom-6 sm:h-14 sm:w-14 ${
        lifted ? "bottom-24" : "bottom-4"
      } ${mobile === "hidden" ? "hidden sm:inline-flex" : "inline-flex"}`}
    >
      {/* The pulsing halo is desktop-only: on a phone it covers the content. */}
      <span className="absolute hidden h-full w-full rounded-full bg-[#25D366] opacity-60 motion-safe:animate-ping sm:inline-flex" aria-hidden />
      <WhatsAppGlyph className="relative h-6 w-6 sm:h-7 sm:w-7" />
    </a>
  );
}
