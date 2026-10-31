import type { Metadata } from "next";
import { PageLayout } from "@/components/site/PageLayout";
import { loadSiteInfo, REGISTERED_ADDRESS, siteHost } from "@/lib/site-pages";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Ela & Co. collects, uses and protects your information.",
  alternates: { canonical: "/privacy" },
};

export default async function PrivacyPage() {
  const info = await loadSiteInfo();
  const email = <a href={`mailto:${info.email}`}>{info.email}</a>;
  return (
    <PageLayout eyebrow="Legal" title="Privacy Policy" intro="Last updated: 31 October 2026" info={info}>
      <p>
        This Privacy Policy is maintained by <strong>Ela &amp; Co.</strong> (“we”, “us”, “our”) and describes how we
        collect, use, and protect information about visitors and customers (“you”) of this website,{" "}
        <strong>{siteHost()}</strong>, our WhatsApp number and related services.
      </p>

      <h2>1. Information we collect</h2>
      <ul>
        <li>
          <strong>Contact information</strong> you provide when placing an order — name, phone number, delivery address,
          email.
        </li>
        <li>
          <strong>Order details</strong> — items ordered, order date, delivery instructions.
        </li>
        <li>
          <strong>Messages</strong> you send us on WhatsApp or through Help &amp; complaints, so we can reply and keep a
          record of your order.
        </li>
        <li>
          <strong>Technical information</strong> — device type, browser, IP address, and pages visited, collected via
          standard web logs and cookies.
        </li>
      </ul>

      <h2>2. How we use your information</h2>
      <ul>
        <li>To prepare, deliver and track your orders.</li>
        <li>To respond to enquiries, feedback and support requests.</li>
        <li>To send order updates via WhatsApp, SMS, or email.</li>
        <li>To send offers on WhatsApp — only if you have agreed to receive them. Reply STOP at any time to stop them.</li>
        <li>To improve our menu, service quality and website.</li>
        <li>To comply with applicable Indian laws.</li>
      </ul>

      <h2>3. Sharing of information</h2>
      <p>
        We do not sell your personal information. We share limited details only with delivery partners, payment
        processors, messaging services (WhatsApp, and the automated assistant that helps us reply), and cloud
        infrastructure providers, strictly to fulfil your order, answer your messages, or as required by law. Online
        payments are handled by our payment partner — we never see or store your card or UPI details.
      </p>

      <h2>4. Cookies</h2>
      <p>
        We use minimal cookies for essential site functionality (e.g. remembering your cart) and anonymous analytics. You
        can disable cookies in your browser, but some features may not work as expected.
      </p>

      <h2>5. Data retention</h2>
      <p>
        Order records are retained for as long as required for accounting, tax and legal compliance under Indian law
        (typically up to 8 years). You may request deletion of your account details at any time by writing to us.
      </p>

      <h2>6. Your rights</h2>
      <p>
        You have the right to access, correct or delete your personal information, and to withdraw consent for marketing
        communications. Write to us at {email}.
      </p>

      <h2>7. Security</h2>
      <p>
        We use reasonable technical and organisational measures to protect your data. However, no method of transmission
        over the internet is 100% secure.
      </p>

      <h2>8. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Material changes will be communicated on this page with a
        revised “last updated” date.
      </p>

      <h2>9. Contact</h2>
      <p>
        Ela &amp; Co., {REGISTERED_ADDRESS}. Email: {email}.
      </p>
    </PageLayout>
  );
}
