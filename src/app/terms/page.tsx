import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/site/PageLayout";
import { loadSiteInfo, REGISTERED_ADDRESS, siteHost } from "@/lib/site-pages";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: "Terms and conditions for using the Ela & Co. website and ordering from us.",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
  const info = await loadSiteInfo();
  return (
    <PageLayout eyebrow="Legal" title="Terms & Conditions" intro="Last updated: 31 October 2026" info={info}>
      <p>
        These Terms &amp; Conditions (“Terms”) govern your use of this website, <strong>{siteHost()}</strong>, ordering
        through our WhatsApp number, and any related services (collectively, the “Service”) operated by{" "}
        <strong>Ela &amp; Co.</strong> (“we”, “us”, “our”), with registered address at {REGISTERED_ADDRESS}.
      </p>
      <p>By accessing or using the Service, you agree to be bound by these Terms.</p>

      <h2>1. Eligibility</h2>
      <p>You must be at least 18 years of age to place an order. By using the Service you confirm that you meet this requirement.</p>

      <h2>2. Orders and acceptance</h2>
      <ul>
        <li>All orders are subject to availability and confirmation.</li>
        <li>
          We reserve the right to refuse or cancel any order at our discretion, including for reasons of item unavailability,
          delivery-zone limits, or suspected fraud.
        </li>
        <li>Order confirmation will be sent via WhatsApp, SMS, or email.</li>
      </ul>

      <h2>3. Pricing and payment</h2>
      <p>
        Prices are listed in Indian Rupees (INR) and include applicable taxes unless stated otherwise. You can pay online —
        by UPI, card or any other method shown at checkout — through our secure payment partner, or by Cash on Delivery
        where it is offered. An order paid online is confirmed once our payment partner confirms the payment; we never see
        or store your card or UPI details. Prices may change without prior notice; the price applicable to your order is
        the one displayed at the time of order confirmation.
      </p>

      <h2>4. Delivery</h2>
      <p>
        We deliver within specified serviceable areas around Thiruvananthapuram — see our{" "}
        <Link href="/delivery">Delivery policy</Link>. Estimated delivery times are indicative and may vary due to traffic,
        weather, or other factors. Risk in the goods passes to you on delivery.
      </p>

      <h2>5. Food quality &amp; allergens</h2>
      <p>
        We prepare food fresh, in kitchens that also handle wheat, dairy, seafood, nuts and other common allergens. If you
        have any allergy or dietary restriction, please inform us before ordering. Consume our food within 2 hours of
        delivery for best quality.
      </p>

      <h2>6. Cancellations &amp; refunds</h2>
      <p>
        Refer to our <Link href="/refund">Refund &amp; Cancellation Policy</Link> for full details.
      </p>

      <h2>7. Intellectual property</h2>
      <p>
        All content on this site — brand marks, photographs, recipes, text, and design — is the property of Ela &amp; Co.
        and may not be copied or reused without written permission.
      </p>

      <h2>8. User conduct</h2>
      <p>
        You agree not to misuse the Service, attempt unauthorised access, or engage in any activity that harms other users
        or our operations.
      </p>

      <h2>9. Limitation of liability</h2>
      <p>
        To the fullest extent permitted by law, Ela &amp; Co. shall not be liable for any indirect, incidental or
        consequential damages arising out of your use of the Service. Our total liability for any claim shall not exceed
        the amount paid by you for the order in question.
      </p>

      <h2>10. Governing law &amp; jurisdiction</h2>
      <p>
        These Terms are governed by the laws of India. Any dispute arising out of or in connection with these Terms shall be
        subject to the exclusive jurisdiction of the courts in Thiruvananthapuram, Kerala.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may revise these Terms from time to time. Continued use of the Service after changes constitutes your acceptance
        of the revised Terms.
      </p>

      <h2>12. Contact</h2>
      <p>
        For questions about these Terms, write to <a href={`mailto:${info.email}`}>{info.email}</a>.
      </p>
    </PageLayout>
  );
}
