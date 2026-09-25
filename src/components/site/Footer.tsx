import Link from "next/link";
import { BrandLogo } from "./BrandLogo";
import { WhatsAppGlyph } from "./WhatsAppGlyph";
import { Instagram, Facebook, Twitter, MessageCircle, Mail, MapPin, Phone } from "lucide-react";

const WA = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "917907577979";

export function Footer() {
  return (
    <footer className="relative bg-charcoal text-ivory">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <div className="flex items-center gap-3">
              <BrandLogo size={56} />
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
                className="min-w-0 flex-1 rounded-l-full bg-white/5 border border-white/10 border-r-0 px-5 py-3 text-base sm:text-sm placeholder:text-ivory/40 focus:outline-none focus:ring-2 focus:ring-gold/60"
              />
              <button type="button" className="shrink-0 rounded-r-full bg-gold px-5 py-3 text-sm font-medium text-charcoal hover:bg-gold-soft transition-colors sm:px-6">
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


export { WhatsAppFab } from "./WhatsAppFab";
export { WhatsAppGlyph };
