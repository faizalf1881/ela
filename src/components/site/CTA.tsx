import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { FloatingLeaves } from "./LeafDecor";

export function CTA() {
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[2.5rem] ring-1 ring-gold/25 shadow-elegant">
          <Image src="/hero-sadya.jpg" alt="" aria-hidden fill sizes="100vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-charcoal/85 via-charcoal/70 to-charcoal/40" />
          <FloatingLeaves />
          <div className="relative px-6 sm:px-12 lg:px-20 py-20 sm:py-28 max-w-3xl">
            <div className="text-xs uppercase tracking-[0.3em] text-gold">Come to the table</div>
            <h2 className="mt-4 font-serif text-4xl sm:text-6xl text-ivory text-balance leading-[1.05]">
              Experience Kerala on every plate.
            </h2>
            <p className="mt-6 text-lg text-ivory/80 max-w-xl">
              A meal you&apos;d travel for — delivered to your door, wrapped in tradition.
            </p>
            <Link
              href="/#menu"
              className="mt-10 inline-flex items-center gap-2 rounded-full bg-gold px-8 py-4 text-sm font-medium text-charcoal hover:bg-gold-soft transition-colors shadow-glow"
            >
              Order Today
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
