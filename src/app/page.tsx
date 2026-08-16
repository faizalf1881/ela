import { getPublicMenu, getStoreSetting, getPublishedReviews } from "@/lib/menu-cache";
import { Navbar } from "@/components/site/Navbar";
import { Hero } from "@/components/site/Hero";
import { MenuGrid, type MenuCardItem } from "@/components/site/MenuGrid";
import { CartBar } from "@/components/site/CartBar";
import { Story } from "@/components/site/Story";
import { WhyUs } from "@/components/site/WhyUs";
import { Reviews, type ReviewItem } from "@/components/site/Reviews";
import { Gallery } from "@/components/site/Gallery";
import { CTA } from "@/components/site/CTA";
import { Footer, WhatsAppFab } from "@/components/site/Footer";

// ISR: the homepage is served as cached static HTML from the CDN and regenerated
// at most every 5 min — or instantly when an admin edits the menu / store status
// (revalidateTag on the "menu"/"settings" tags this page's data reads).
export const revalidate = 300;

async function getData(): Promise<{ menu: MenuCardItem[]; accepting: boolean; closedMessage: string | null; reviews: ReviewItem[] }> {
  try {
    const [items, setting, reviews] = await Promise.all([getPublicMenu(), getStoreSetting(), getPublishedReviews()]);
    return {
      menu: items.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        price: m.price,
        discountPercent: m.discountPercent,
        tag: m.tag,
        spice: m.spice,
        imageUrl: m.imageUrl,
        category: m.category,
        stock: m.stock,
      })),
      accepting: setting ? setting.acceptingOrders : true,
      closedMessage: setting?.closedMessage ?? null,
      reviews: reviews.map((r) => ({ authorName: r.authorName, location: r.location, rating: r.rating, body: r.body })),
    };
  } catch {
    return { menu: [], accepting: true, closedMessage: null, reviews: [] };
  }
}

export default async function HomePage() {
  const { menu, accepting, closedMessage, reviews } = await getData();
  return (
    <main className="min-h-screen bg-background">
      <Navbar />
      {!accepting && (
        <div className="fixed top-20 inset-x-0 z-40 flex justify-center px-4">
          <div className="rounded-full bg-destructive px-5 py-2 text-sm font-medium text-destructive-foreground shadow-elegant">
            {closedMessage || "We're currently not accepting orders. Please check back soon."}
          </div>
        </div>
      )}
      <Hero />
      <MenuGrid items={menu} accepting={accepting} />
      <Story />
      <WhyUs />
      <Reviews reviews={reviews} />
      <Gallery />
      <CTA />
      <Footer />
      <WhatsAppFab />
      <CartBar />
    </main>
  );
}
