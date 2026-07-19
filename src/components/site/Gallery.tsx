import Image from "next/image";

export function Gallery() {
  const imgs = [
    { src: "/gallery/1.jpg", alt: "Hands grinding spices", cls: "row-span-2" },
    { src: "/gallery/2.jpg", alt: "Fresh coconut and spices" },
    { src: "/gallery/3.jpg", alt: "Kerala breakfast" },
    { src: "/gallery/4.jpg", alt: "Payasam in brass bowl", cls: "row-span-2" },
    { src: "/menu/fish.jpg", alt: "Fish curry" },
    { src: "/menu/sadya.jpg", alt: "Full sadya" },
  ];
  return (
    <section id="gallery" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl mb-14">
          <div className="text-xs uppercase tracking-[0.3em] text-gold">Gallery</div>
          <h2 className="mt-4 font-serif text-4xl sm:text-5xl text-foreground text-balance">The kitchen, in fragments.</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 auto-rows-[180px] md:auto-rows-[220px] gap-3 md:gap-4">
          {imgs.map((im, i) => (
            <div key={i} className={`group relative overflow-hidden rounded-2xl ring-1 ring-border ${im.cls ?? ""}`}>
              <Image
                src={im.src}
                alt={im.alt}
                fill
                sizes="(max-width: 768px) 50vw, 25vw"
                className="object-cover transition-transform duration-[1200ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-charcoal/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
