import { Sparkles, Leaf, Wheat, ShieldCheck, Bike, Lock, Heart } from "lucide-react";

const items = [
  { i: Sparkles, t: "Freshly Prepared Daily", d: "Cooked the morning of delivery." },
  { i: Leaf, t: "Traditional Recipes", d: "Handed down through generations." },
  { i: Wheat, t: "Premium Ingredients", d: "Sourced from Kerala farms." },
  { i: ShieldCheck, t: "Hygienic Cooking", d: "FSSAI certified kitchens." },
  { i: Bike, t: "Fast Delivery", d: "Piping hot in under 45 minutes." },
  { i: Lock, t: "Secure Payments", d: "UPI, cards, wallets, COD." },
  { i: Heart, t: "Loved by Customers", d: "4.9★ across 2,400+ reviews." },
];

export function WhyUs() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto">
          <div className="text-xs uppercase tracking-[0.3em] text-gold">Why Ela Cuisine</div>
          <h2 className="mt-4 font-serif text-4xl sm:text-5xl text-foreground text-balance">
            Small details, deeply considered.
          </h2>
        </div>

        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {items.map(({ i: Icon, t, d }) => (
            <div
              key={t}
              className="group relative rounded-3xl bg-card ring-1 ring-border p-6 hover:shadow-elegant hover:-translate-y-1 transition-all duration-500"
            >
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-forest/10 text-forest ring-1 ring-forest/15 group-hover:bg-gold/15 group-hover:text-gold transition-colors">
                <Icon className="h-5 w-5" />
              </div>
              <div className="mt-5 font-serif text-xl text-foreground">{t}</div>
              <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
