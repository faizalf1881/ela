import Link from "next/link";
import { Instagram, Facebook, Twitter, MessageCircle, Mail, MapPin, Phone } from "lucide-react";

const WA = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "917907577979";

export function Footer() {
  return (
    <footer className="relative bg-charcoal text-ivory">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ela-logo.jpeg" alt="Ela & Co." className="h-12 w-12 rounded-full ring-1 ring-gold/40 object-cover" />
              <div>
                <div className="font-serif text-2xl">Ela &amp; Co.</div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-gold">Flavours Wrapped in Tradition</div>
              </div>
            </div>
            <p className="mt-6 text-ivory/70 max-w-md leading-relaxed">
              A Kerala food house preserving authentic recipes for a modern table. Ela Cuisine is our first brand —
              more coming soon.
            </p>

            <div className="mt-8 flex max-w-md">
              <input
                type="email"
                placeholder="Your email"
                className="flex-1 rounded-l-full bg-white/5 border border-white/10 border-r-0 px-5 py-3 text-sm placeholder:text-ivory/40 focus:outline-none focus:ring-2 focus:ring-gold/60"
              />
              <button type="button" className="rounded-r-full bg-gold px-6 py-3 text-sm font-medium text-charcoal hover:bg-gold-soft transition-colors">
                Subscribe
              </button>
            </div>
            <p className="mt-2 text-xs text-ivory/50">Recipes, stories &amp; drops. No spam.</p>
          </div>

          <div className="lg:col-span-3">
            <div className="text-[10px] uppercase tracking-[0.3em] text-gold mb-4">Explore</div>
            <ul className="space-y-3 text-sm text-ivory/80">
              <li><Link href="/#menu" className="hover:text-gold">Menu</Link></li>
              <li><Link href="/#story" className="hover:text-gold">Our Story</Link></li>
              <li><Link href="/#gallery" className="hover:text-gold">Gallery</Link></li>
              <li><Link href="/orders" className="hover:text-gold">Track your order</Link></li>
              <li><Link href="/support" className="hover:text-gold">Help &amp; complaints</Link></li>
              <li><Link href="/login" className="hover:text-gold">Customer login</Link></li>
            </ul>
          </div>

          <div className="lg:col-span-4">
            <div className="text-[10px] uppercase tracking-[0.3em] text-gold mb-4">Reach us</div>
            <ul className="space-y-3 text-sm text-ivory/80">
              <li className="flex items-start gap-3">
                <MapPin className="h-4 w-4 text-gold mt-0.5 shrink-0" />
                <span>TC 11/1074, PKRA 130, Pattom P.O., Thiruvananthapuram, Kerala — 695004</span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-gold" />
                <a href={`tel:+${WA}`} className="hover:text-gold">+91 79075 77979</a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-gold" />
                <a href="mailto:admin.ela.co@gmail.com" className="hover:text-gold">admin.ela.co@gmail.com</a>
              </li>
            </ul>
            <div className="mt-6 flex items-center gap-3">
              {[Instagram, Facebook, Twitter, MessageCircle].map((I, i) => (
                <a
                  key={i}
                  href={i === 3 ? `https://wa.me/${WA}` : "#"}
                  target={i === 3 ? "_blank" : undefined}
                  rel={i === 3 ? "noreferrer" : undefined}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 hover:border-gold hover:text-gold transition-colors"
                >
                  <I className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-16 pt-8 border-t border-white/10 flex flex-wrap justify-between gap-4 text-xs text-ivory/50">
          <div>© {new Date().getFullYear()} Ela &amp; Co. All rights reserved.</div>
          <div>Handcrafted in Kerala.</div>
        </div>
      </div>
    </footer>
  );
}

export function WhatsAppGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347M12.05 21.785h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.999-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.002-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.892c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652a12.062 12.062 0 0 0 5.71 1.447h.006c6.585 0 11.946-5.335 11.949-11.893a11.821 11.821 0 0 0-3.48-8.413" />
    </svg>
  );
}

export function WhatsAppFab() {
  return (
    <a
      href={`https://wa.me/${WA}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat on WhatsApp"
      className="group fixed bottom-6 right-6 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-elegant transition-transform hover:scale-110"
    >
      <span className="absolute inline-flex h-full w-full rounded-full bg-[#25D366] opacity-60 motion-safe:animate-ping" aria-hidden />
      <WhatsAppGlyph className="relative h-7 w-7" />
    </a>
  );
}
