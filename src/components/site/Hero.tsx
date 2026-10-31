import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Utensils, Gift } from "lucide-react";
import { FloatingLeaves } from "./LeafDecor";
import { FeaturedAddButton } from "./FeaturedAddButton";
import { inr } from "@/lib/utils";
import type { FeaturedDish, HeroStat } from "@/lib/site-content";

/**
 * Homepage hero. Everything that changes day to day — the dish card, the offer
 * banner, the highlights and the rating — comes from Admin → Website and the
 * live menu (spec #6/#7); nothing here is hard-coded to one dish or price.
 */
export function Hero({
  featured,
  promo,
  stats,
  rating,
  accepting = true,
}: {
  featured: FeaturedDish | null;
  promo: { text: string; code: string | null } | null;
  stats: HeroStat[];
  rating: { value: string; note: string } | null;
  accepting?: boolean;
}) {
  return (
    <section className="relative min-h-[100svh] overflow-hidden pt-28 pb-16 sm:pb-24">
      <div className="absolute inset-0 -z-10" style={{ background: "var(--gradient-hero)" }} />
      <FloatingLeaves />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-10 lg:gap-16 items-center">
          <div className="lg:col-span-6 animate-fade-up">
            <div className="inline-flex items-center gap-2 rounded-full glass px-4 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-gold" />
              <span className="text-xs uppercase tracking-[0.28em] text-foreground/70">Ela Cuisine · Kerala</span>
            </div>

            {promo && (
              <div data-promo className="mt-4 flex max-w-xl flex-wrap items-center gap-2 rounded-2xl bg-gold/20 px-4 py-2.5 text-sm text-foreground ring-1 ring-gold/40">
                <Gift className="h-4 w-4 shrink-0 text-[oklch(0.5_0.12_75)]" />
                <span className="min-w-0">{promo.text}</span>
                {promo.code && (
                  <span className="rounded-full bg-charcoal px-2.5 py-0.5 font-mono text-xs font-semibold tracking-wider text-ivory">{promo.code}</span>
                )}
              </div>
            )}

            <h1 className="mt-6 font-serif text-5xl sm:text-6xl lg:text-7xl leading-[1.02] text-balance text-foreground">
              Authentic Kerala Meals, <em className="italic text-forest">crafted with tradition</em>.
            </h1>

            <p className="mt-6 max-w-xl text-lg text-muted-foreground leading-relaxed">
              Every plate is freshly prepared using recipes passed down through generations — coconut, curry leaf, and
              slow-simmered spice, plated on banana leaf.
            </p>

            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link
                href="/#menu"
                className="group inline-flex items-center gap-2 rounded-full bg-primary px-7 py-4 text-sm font-medium text-primary-foreground shadow-elegant hover:shadow-glow transition-all duration-500"
              >
                Order Now
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/#menu"
                className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-transparent px-7 py-4 text-sm font-medium text-foreground hover:bg-gold/10 transition-colors"
              >
                <Utensils className="h-4 w-4 text-gold" />
                Explore Menu
              </Link>
            </div>

            {stats.length > 0 && (
              <div className="mt-12 grid max-w-md grid-cols-3 gap-4 sm:flex sm:max-w-none sm:items-center sm:gap-8">
                {stats.map((s) => (
                  <div key={s.label}>
                    <div className="font-serif text-3xl text-foreground">{s.value}</div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground mt-1">{s.label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="lg:col-span-6 relative animate-fade-up" style={{ animationDelay: "0.15s" }}>
            <div className="relative aspect-[4/5] w-full rounded-[2rem] overflow-hidden shadow-elegant ring-1 ring-gold/25">
              <Image
                src={featured?.imageUrl || "/hero-sadya.jpg"}
                alt={featured ? featured.name : "Traditional Kerala sadya served on a banana leaf"}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/40 via-transparent to-transparent" />
              {featured && (
                <div
                  className="absolute bottom-4 left-4 right-4 glass rounded-2xl p-4 sm:bottom-6 sm:left-6 sm:right-6 sm:p-5"
                  data-featured-id={featured.id}
                  data-featured-price={featured.price}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-[0.3em] text-gold">{featured.label}</div>
                      <div className="font-serif text-xl text-foreground mt-1 leading-tight">{featured.name}</div>
                    </div>
                    <div className="text-right shrink-0">
                      {featured.soldOut ? (
                        <div className="rounded-full bg-charcoal px-3 py-1 text-xs font-medium text-ivory">Sold out today</div>
                      ) : (
                        <>
                          <div className="font-serif text-2xl text-foreground">{inr(featured.price)}</div>
                          {featured.mrp > featured.price && <div className="text-xs text-muted-foreground line-through">{inr(featured.mrp)}</div>}
                        </>
                      )}
                      {featured.servingInfo && <div className="text-xs text-muted-foreground">{featured.servingInfo}</div>}
                    </div>
                  </div>
                  {featured.description && <p className="mt-2 line-clamp-2 text-sm leading-snug text-muted-foreground">{featured.description}</p>}
                  {!featured.soldOut && accepting && (
                    <div className="mt-3">
                      <FeaturedAddButton dish={featured} />
                    </div>
                  )}
                </div>
              )}
            </div>

            {rating && (
              <div className="absolute -top-6 -right-4 hidden md:block glass rounded-2xl px-4 py-3 shadow-soft">
                <div className="text-[10px] uppercase tracking-[0.28em] text-gold">Rated</div>
                <div className="font-serif text-2xl text-foreground">{rating.value}</div>
                {rating.note && <div className="text-xs text-muted-foreground">{rating.note}</div>}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
