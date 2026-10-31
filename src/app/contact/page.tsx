import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MapPin, MessageCircle } from "lucide-react";
import { PageLayout } from "@/components/site/PageLayout";
import { loadDeliveryFacts, loadSiteInfo, REGISTERED_ADDRESS, WHATSAPP_LINK } from "@/lib/site-pages";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Phone, WhatsApp, email and address for Ela & Co.",
  alternates: { canonical: "/contact" },
};

export default async function ContactPage() {
  const [info, facts] = await Promise.all([loadSiteInfo(), loadDeliveryFacts()]);
  const email = <a href={`mailto:${info.email}`}>{info.email}</a>;
  return (
    <PageLayout
      eyebrow="Reach us"
      title="We'd love to hear from you."
      intro="For orders, catering, feedback or collaborations — we usually reply within a working day."
      info={info}
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-3xl border border-border bg-card p-8 shadow-soft">
          <MapPin className="h-6 w-6 text-gold" />
          <div className="mt-4 font-serif text-xl text-foreground">Registered address</div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground" data-registered-address>
            Ela &amp; Co.
            <br />
            {REGISTERED_ADDRESS}
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-8 shadow-soft">
          <Mail className="h-6 w-6 text-gold" />
          <div className="mt-4 font-serif text-xl text-foreground">Email</div>
          <p className="mt-2 text-sm">{email}</p>
          <div className="mt-6 h-px bg-border" />
          <MessageCircle className="mt-6 h-6 w-6 text-gold" />
          <div className="mt-4 font-serif text-xl text-foreground">Phone &amp; WhatsApp</div>
          <p className="mt-2 space-y-1 text-sm">
            <a href={info.phoneDial ? `tel:+${info.phoneDial}` : undefined} className="block">
              {info.phone}
            </a>
            <a href={WHATSAPP_LINK} className="block">
              Chat with us on WhatsApp
            </a>
          </p>
        </div>
      </div>

      {(info.openingHours || facts) && (
        <>
          <h2>Business hours</h2>
          {info.openingHours && <p>{info.openingHours}</p>}
          {facts && (
            <p>
              We deliver {facts.days} — see our <Link href="/delivery">Delivery policy</Link> for areas and time slots.
            </p>
          )}
        </>
      )}

      <h2>Help with an order</h2>
      <p>
        Log in and raise a ticket at <Link href="/support">Help &amp; complaints</Link> — you can add photos, and we&apos;ll
        reply there. You can also <a href={WHATSAPP_LINK}>WhatsApp us</a> or write to {email}.
      </p>

      <h2>Grievance officer</h2>
      <p>
        In accordance with the Information Technology Act, 2000 and applicable rules, the contact details of the Grievance
        Officer are: <strong>Ela &amp; Co. Grievance Cell</strong>, {email}. We acknowledge complaints within 48 hours and
        resolve them within 15 days.
      </p>
    </PageLayout>
  );
}
