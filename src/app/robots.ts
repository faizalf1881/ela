import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://www.elaandco.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/kitchen", "/api", "/checkout", "/orders"],
    },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
