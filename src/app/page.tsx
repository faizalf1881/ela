import { getPublicMenu, getStoreSetting, getPublishedReviews, getSiteContent } from "@/lib/menu-cache";
import { effectivePrice } from "@/lib/pricing";
import { heroStats, publicSiteInfo, ratingBadge, resolveFeatured, type FeaturedDish, type HeroStat, type PublicSiteInfo } from "@/lib/site-content";
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
// / website content (revalidateTag on the tags this page's data reads).
export const revalidate = 300;

type HomeData = {
  menu: MenuCardItem[];
  accepting: boolean;
  closedMessage: string | null;
  codEnabled: boolean;
  reviews: ReviewItem[];
  featured: FeaturedDish | null;
  stats: HeroStat[];
  rating: { value: string; note: string } | null;
  info: PublicSiteInfo;
};

async function getData(): Promise<HomeData> {
  try {
    const [items, setting, reviews, content] = await Promise.all([getPublicMenu(), getStoreSetting(), getPublishedReviews(), getSiteContent()]);
    const info = publicSiteInfo(content);
    const rating = ratingBadge(content, reviews);
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
        servingInfo: m.servingInfo,
      })),
      accepting: setting ? setting.acceptingOrders : true,
      closedMessage: setting?.closedMessage ?? null,
      codEnabled: setting?.codEnabled ?? true,
      reviews: reviews.map((r) => ({ authorName: r.authorName, location: r.location, rating: r.rating, body: r.body })),
      featured: resolveFeatured(items, content, effectivePrice),
      stats: heroStats(content, { dishCount: items.length, deliveryTime: info.deliveryTime }),
      rating,
      info,
    };
  } catch {
    const info = publicSiteInfo(null);
    return { menu: [], accepting: true, closedMessage: null, codEnabled: true, reviews: [], featured: null, stats: heroStats(null, { dishCount: 0, deliveryTime: info.deliveryTime }), rating: null, info };
  }
}

export default async function HomePage() {
  const { menu, accepting, closedMessage, codEnabled, reviews, featured, stats, rating, info } = await getData();
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
      <Hero featured={featured} promo={info.promo} stats={stats} rating={rating} accepting={accepting} />
      <MenuGrid items={menu} accepting={accepting} deliveryTime={info.deliveryTime} />
      <Story />
      <WhyUs deliveryTime={info.deliveryTime} codEnabled={codEnabled} rating={rating} />
      <Reviews reviews={reviews} />
      <Gallery />
      <CTA />
      <Footer info={info} />
      <WhatsAppFab mobile="above-cart" />
      <CartBar />
    </main>
  );
}
