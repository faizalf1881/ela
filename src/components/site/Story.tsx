import Image from "next/image";

const pillars = [
  { t: "Kerala Heritage", d: "Recipes rooted in the villages of Malabar, Travancore and Kochi." },
  { t: "Traditional Craft", d: "Stone-ground masalas, clay pots, wood-fire finish where it matters." },
  { t: "Fresh Every Day", d: "Coconut scraped that morning. Curry leaves picked before dawn." },
  { t: "Homemade Quality", d: "Cooked in small batches by chefs who learned from their mothers." },
];

export function Story() {
  return (
    <section id="story" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className="relative">
            <div className="relative aspect-[4/5] rounded-[2rem] overflow-hidden shadow-elegant ring-1 ring-gold/20">
              <Image src="/story-kerala.jpg" alt="Kerala backwaters at dawn" fill sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" />
            </div>
            <div className="absolute -bottom-8 -right-4 md:-right-10 glass rounded-2xl p-6 max-w-xs shadow-soft">
              <div className="font-serif italic text-lg text-foreground leading-snug">
                &ldquo;Rooted in tradition, served with heart.&rdquo;
              </div>
              <div className="mt-2 text-xs uppercase tracking-widest text-gold">— Ela &amp; Co.</div>
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold">Our Story</div>
            <h2 className="mt-4 font-serif text-4xl sm:text-5xl text-foreground text-balance">
              A quiet devotion to how Kerala has always eaten.
            </h2>
            <p className="mt-6 text-muted-foreground text-lg leading-relaxed">
              Ela Cuisine began in a small kitchen with one belief — that a proper Kerala meal is not a dish but a
              memory. We honour that memory with slow craft, fresh coconut, and spice that whispers before it sings.
            </p>

            <div className="mt-10 grid sm:grid-cols-2 gap-6">
              {pillars.map((p) => (
                <div key={p.t} className="group">
                  <div className="hairline-gold" />
                  <div className="pt-4">
                    <div className="font-serif text-xl text-foreground">{p.t}</div>
                    <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{p.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
