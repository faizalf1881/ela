import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ela & Co. — Authentic Kerala Meals",
    short_name: "Ela & Co.",
    description: "Authentic Kerala homemade meals, freshly prepared and delivered.",
    start_url: "/",
    display: "standalone",
    background_color: "#F8F5EE",
    theme_color: "#4B5A24",
    icons: [
      { src: "/brand/ela-logo-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
