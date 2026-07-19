import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CartProvider } from "@/lib/cart";
import { AuthProvider } from "@/lib/auth-client";
import { CartSheet } from "@/components/site/CartSheet";
import { Toaster } from "sonner";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.elaandco.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Ela & Co. — Flavours Wrapped in Tradition | Authentic Kerala Meals",
    template: "%s · Ela & Co.",
  },
  description:
    "Ela Cuisine by Ela & Co. — authentic Kerala homemade meals crafted from generations-old recipes, delivered fresh to your door.",
  applicationName: "Ela & Co.",
  icons: { icon: "/ela-logo.jpeg", apple: "/ela-logo.jpeg" },
  openGraph: {
    title: "Ela & Co. — Authentic Kerala Meals",
    description: "Authentic Kerala meals, freshly prepared and delivered.",
    type: "website",
    url: SITE_URL,
    siteName: "Ela & Co.",
  },
  twitter: { card: "summary_large_image", title: "Ela & Co. — Authentic Kerala Meals" },
};

export const viewport: Viewport = {
  themeColor: "#4B5A24",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@300;400;500;600;700&display=swap"
        />
      </head>
      <body>
        <AuthProvider>
          <CartProvider>
            {children}
            <CartSheet />
            <Toaster position="top-center" richColors />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
