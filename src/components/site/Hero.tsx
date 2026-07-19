import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Utensils } from "lucide-react";
import { FloatingLeaves } from "./LeafDecor";

export function Hero() {
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

            <div className="mt-12 flex items-center gap-8">
              {[
                { n: "12+", l: "Traditional Meals" },
                { n: "100%", l: "Homemade" },
                { n: "45 min", l: "Avg Delivery" },
              ].map((s) => (
                <div key={s.l}>
                  <div className="font-serif text-3xl text-foreground">{s.n}</div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mt-1">{s.l}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 relative animate-fade-up" style={{ animationDelay: "0.15s" }}>
            <div className="relative aspect-[4/5] w-full rounded-[2rem] overflow-hidden shadow-elegant ring-1 ring-gold/25">
              <Image
                src="/hero-sadya.jpg"
                alt="Traditional Kerala sadya served on a banana leaf"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 50vw"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/40 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 glass rounded-2xl p-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.3em] text-gold">Today&apos;s Special</div>
                    <div className="font-serif text-xl text-foreground mt-1">Onam Sadya Feast</div>
                  </div>
                  <div className="text-right">
                    <div className="font-serif text-2xl text-foreground">₹349</div>
                    <div className="text-xs text-muted-foreground">Serves 1</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -top-6 -right-4 hidden md:block glass rounded-2xl px-4 py-3 shadow-soft">
              <div className="text-[10px] uppercase tracking-[0.28em] text-gold">Rated</div>
              <div className="font-serif text-2xl text-foreground">4.9 ★</div>
              <div className="text-xs text-muted-foreground">2,400+ reviews</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
