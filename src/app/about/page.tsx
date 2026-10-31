import type { Metadata } from "next";
import { PageLayout } from "@/components/site/PageLayout";
import { loadSiteInfo, REGISTERED_ADDRESS } from "@/lib/site-pages";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "About Us",
  description: "Ela & Co. is a Kerala-born food house built around generations-old recipes.",
  alternates: { canonical: "/about" },
};

export default async function AboutPage() {
  const info = await loadSiteInfo();
  return (
    <PageLayout
      eyebrow="Our Story"
      title="Flavours wrapped in tradition."
      intro="Ela & Co. is a Kerala-born food house built around generations-old recipes, slow cooking, and the quiet ritual of a home-cooked meal."
      info={info}
    >
      <h2>Who we are</h2>
      <p>
        <strong>Ela &amp; Co.</strong> is a Kerala-based food company headquartered in Thiruvananthapuram. Our flagship
        brand, <em>Ela Cuisine</em>, brings authentic Kerala meals — sadya, meen curry, nadan kozhi, appam — from our
        kitchen to your table, prepared with the same care as at home.
      </p>

      <h2>What we stand for</h2>
      <ul>
        <li>
          <strong>Authenticity</strong> — traditional recipes, unaltered, sourced from home kitchens across Kerala.
        </li>
        <li>
          <strong>Freshness</strong> — cooked to order, never reheated, served on banana leaf whenever possible.
        </li>
        <li>
          <strong>Craft</strong> — small batches, real spices ground in-house, cold-pressed coconut oil.
        </li>
        <li>
          <strong>Respect</strong> — for our farmers, our cooks, our guests, and the produce itself.
        </li>
      </ul>

      <h2>Legal entity</h2>
      <p>
        This website is owned and operated by <strong>Ela &amp; Co.</strong> — a proprietary food business registered in
        Kerala, India. Registered address: {REGISTERED_ADDRESS}.
      </p>

      <h2>Get in touch</h2>
      <p>
        Questions, collaborations, or catering enquiries — write to us at <a href={`mailto:${info.email}`}>{info.email}</a>.
      </p>
    </PageLayout>
  );
}
