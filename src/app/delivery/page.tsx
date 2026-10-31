import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/site/PageLayout";
import { loadDeliveryFacts, loadSiteInfo, WHATSAPP_LINK } from "@/lib/site-pages";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Delivery Policy",
  description: "Where and when Ela & Co. delivers, delivery charges and packaging.",
  alternates: { canonical: "/delivery" },
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default async function DeliveryPage() {
  const [info, facts] = await Promise.all([loadSiteInfo(), loadDeliveryFacts()]);
  return (
    <PageLayout eyebrow="Delivery policy" title="How we get it to you." intro="Hot, on time and in packaging we're proud of." info={info}>
      <h2>Where we deliver</h2>
      {facts && facts.areas.length > 0 ? (
        <>
          <p>We currently deliver to these areas. The delivery fee for your area is added at checkout, before you pay.</p>
          <ul data-delivery-areas>
            {facts.areas.map((a) => (
              <li key={`${a.name}|${a.area ?? ""}`}>
                <strong>{a.name}</strong>
                {a.area ? ` (${a.area})` : ""} — {a.fee > 0 ? `${inr(a.fee)} delivery` : "free delivery"}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>We deliver across Thiruvananthapuram city. Your area and its delivery fee are shown at checkout, before you pay.</p>
      )}
      <p>
        Not on the list? <a href={WHATSAPP_LINK}>WhatsApp us</a> your PIN code and we&apos;ll check.
      </p>

      <h2>Days and timings</h2>
      <ul>
        {facts && (
          <li>
            We deliver <strong>{facts.days}</strong>
            {facts.slots.length > 0 ? <>, in these time slots: {facts.slots.join(", ")}</> : null}. You choose your day and
            slot at checkout.
          </li>
        )}
        {facts && (
          <li>
            {facts.sameDayBefore ? (
              <>
                Order before <strong>{facts.sameDayBefore}</strong> for delivery the same day; later orders go to the next
                delivery day.
              </>
            ) : (
              <>Orders are delivered from the next delivery day onwards — we don&apos;t offer same-day delivery.</>
            )}
          </li>
        )}
        {facts && (
          <li>
            You can order up to <strong>{facts.preorderDays} days</strong> ahead.
          </li>
        )}
        <li>Catering &amp; sadya: 3–7 days lead time.</li>
      </ul>

      <h2>Charges</h2>
      <ul>
        <li>The delivery fee depends on your area and is always shown at checkout, before you pay.</li>
        <li>
          Prices and fees are in Indian Rupees (INR). See our <Link href="/terms">Terms &amp; Conditions</Link> for payment
          options.
        </li>
      </ul>

      <h2>Packaging</h2>
      <p>
        Meal boxes use compostable bagasse and kraft. Curries and gravies travel in leak-proof containers. Larger catering
        orders arrive on fresh banana leaves. We don&apos;t send plastic cutlery — please use what&apos;s at home.
      </p>

      <h2>Missed or delayed deliveries</h2>
      <p>
        If your order runs more than 30 minutes late, we&apos;ll call you. If it doesn&apos;t arrive at all, we refund in
        full — refer to our <Link href="/refund">Refund &amp; Cancellation policy</Link>.
      </p>
    </PageLayout>
  );
}
