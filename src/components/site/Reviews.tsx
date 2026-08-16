import { Star } from "lucide-react";

export type ReviewItem = { authorName: string; location: string | null; rating: number; body: string };

export function Reviews({ reviews }: { reviews: ReviewItem[] }) {
  if (!reviews.length) return null;

  // Repeat so the marquee loops smoothly even with a handful of reviews.
  let loop = [...reviews];
  while (loop.length < 8) loop = [...loop, ...reviews];
  loop = [...loop, ...loop];

  const avg = (reviews.reduce((n, r) => n + r.rating, 0) / reviews.length).toFixed(1);

  return (
    <section id="reviews" className="relative py-24 sm:py-32 bg-secondary/40 overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6 mb-12">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-gold">Reviews</div>
            <h2 className="mt-4 font-serif text-4xl sm:text-5xl text-foreground">A quiet ovation from our regulars.</h2>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} className="h-5 w-5 fill-gold text-gold" />
              ))}
            </div>
            <div className="text-sm text-muted-foreground">{avg} average · {reviews.length} review{reviews.length > 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>

      <div className="relative" style={{ maskImage: "linear-gradient(90deg, transparent, black 8%, black 92%, transparent)" }}>
        <div className="flex gap-6 animate-marquee w-max px-4">
          {loop.map((r, i) => (
            <figure key={i} className="w-[340px] shrink-0 rounded-3xl bg-card ring-1 ring-border p-6 shadow-soft">
              <div className="flex gap-1 mb-3">
                {Array.from({ length: Math.max(1, Math.min(5, r.rating)) }).map((_, s) => (
                  <Star key={s} className="h-4 w-4 fill-gold text-gold" />
                ))}
              </div>
              <blockquote className="font-serif text-lg leading-snug text-foreground italic">&ldquo;{r.body}&rdquo;</blockquote>
              <figcaption className="mt-5 flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-forest to-forest-deep text-primary-foreground flex items-center justify-center font-serif text-sm">
                  {r.authorName.split(" ").map((x) => x[0]).slice(0, 2).join("")}
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{r.authorName}</div>
                  {r.location && <div className="text-xs text-muted-foreground">{r.location}</div>}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
