import type { ReactNode } from "react";
import { Navbar } from "./Navbar";
import { Footer, WhatsAppFab } from "./Footer";
import type { PublicSiteInfo } from "@/lib/site-content";

/** The text pages (policies, contact, about) — same look as the original site's pages. */
export function PageLayout({
  eyebrow,
  title,
  intro,
  info,
  children,
}: {
  eyebrow?: string;
  title: string;
  intro?: string;
  info: PublicSiteInfo;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      <section className="relative isolate pt-36 pb-16 sm:pt-40 sm:pb-20">
        <div className="absolute inset-0 -z-10 opacity-70" style={{ background: "var(--gradient-hero)" }} />
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
          {eyebrow && <div className="text-xs uppercase tracking-[0.3em] text-gold">{eyebrow}</div>}
          <h1 className="mt-4 text-balance font-serif text-4xl text-foreground sm:text-6xl">{title}</h1>
          {intro && <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">{intro}</p>}
          <div className="hairline-gold mx-auto mt-8 w-40" />
        </div>
      </section>
      <section className="pb-28">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <div className="space-y-6 leading-relaxed text-foreground/80 [&_a]:text-forest [&_a]:underline [&_a]:underline-offset-4 [&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:font-serif [&_h2]:text-3xl [&_h2]:text-foreground [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
            {children}
          </div>
        </div>
      </section>
      <Footer info={info} />
      <WhatsAppFab />
    </main>
  );
}
