import type { Metadata } from "next";
import { PageLayout } from "@/components/site/PageLayout";
import { loadSiteInfo, WHATSAPP_LINK } from "@/lib/site-pages";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy",
  description: "Order cancellation and refund policy for Ela & Co. food orders.",
  alternates: { canonical: "/refund" },
};

export default async function RefundPage() {
  const info = await loadSiteInfo();
  const email = <a href={`mailto:${info.email}`}>{info.email}</a>;
  return (
    <PageLayout
      eyebrow="Legal"
      title="Refund & Cancellation Policy"
      intro="Because we prepare each meal fresh to order, our policy is short and fair. Last updated: 05 July 2026."
      info={info}
    >
      <h2>1. Cancellations by you</h2>
      <ul>
        <li>
          Orders may be cancelled free of charge <strong>within 15 minutes</strong> of placing the order, provided
          preparation has not begun.
        </li>
        <li>
          Once preparation has started, orders <strong>cannot be cancelled</strong> as ingredients are already committed.
        </li>
        <li>
          To cancel, <a href={WHATSAPP_LINK}>WhatsApp us</a> or email {email} with your order details.
        </li>
      </ul>

      <h2>2. Cancellations by us</h2>
      <p>
        We may cancel an order if the item is unavailable, the delivery address is outside our serviceable zone, or due to
        unforeseen operational issues. In such cases, if any payment has been collected, it will be refunded in full.
      </p>

      <h2>3. Refunds</h2>
      <ul>
        <li>
          Refunds, when applicable, are processed within <strong>5–7 business days</strong> to the original mode of payment.
        </li>
        <li>For Cash on Delivery orders, no advance is collected, so no refund applies unless we have already collected cash.</li>
        <li>We do not offer partial refunds for items that have been consumed.</li>
      </ul>

      <h2>4. Issues with your order</h2>
      <p>
        If your order arrives damaged, incorrect, or unacceptable in quality, please contact us{" "}
        <strong>within 60 minutes of delivery</strong> with photographs, and we will replace the item or issue a refund at
        our discretion. We are unable to entertain claims raised after this window because of the perishable nature of our
        food.
      </p>

      <h2>5. Non-refundable situations</h2>
      <ul>
        <li>Change of mind after preparation has started.</li>
        <li>Incorrect delivery address or unavailability at the time of delivery.</li>
        <li>Delays caused by weather, traffic or events beyond our reasonable control.</li>
      </ul>

      <h2>6. Contact</h2>
      <p>For any refund or cancellation request, please write to {email}. We aim to respond within one working day.</p>
    </PageLayout>
  );
}
