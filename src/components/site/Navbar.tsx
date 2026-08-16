"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingBag, Menu, X, User, LayoutDashboard, ChefHat, Crown } from "lucide-react";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth-client";

const links = [
  { label: "Menu", href: "/#menu" },
  { label: "Our Story", href: "/#story" },
  { label: "Membership", href: "/membership" },
  { label: "Gallery", href: "/#gallery" },
  { label: "Reviews", href: "/#reviews" },
];

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { count, openCart } = useCart();
  const { user, membership } = useAuth();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const account =
    user?.role === "admin"
      ? { href: "/admin", label: "Admin", icon: LayoutDashboard }
      : user?.role === "kitchen"
        ? { href: "/kitchen", label: "Kitchen", icon: ChefHat }
        : user?.role === "customer"
          ? { href: "/orders", label: user.name || "My Orders", icon: User }
          : { href: "/login", label: "Login", icon: User };

  const AccountIcon = account.icon;

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${scrolled ? "py-2" : "py-4"}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div
          className={`flex items-center justify-between rounded-full px-4 sm:px-6 py-2.5 transition-all duration-500 ${
            scrolled ? "glass shadow-soft" : "bg-transparent"
          }`}
        >
          <Link href="/" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ela-logo.jpeg" alt="Ela & Co." className="h-10 w-10 rounded-full object-cover ring-1 ring-gold/40" />
            <div className="leading-tight">
              <div className="font-serif text-lg text-foreground">Ela &amp; Co.</div>
              <div className="text-[10px] uppercase tracking-[0.28em] text-gold">Ela Cuisine</div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-8">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="text-sm text-foreground/80 hover:text-foreground transition-colors">
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {membership.active && (
              <Link
                href="/membership"
                title={`${membership.planName} member`}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-gold px-3 py-2 text-xs font-semibold text-charcoal shadow-soft"
              >
                <Crown className="h-3.5 w-3.5" /> Premium
              </Link>
            )}
            <Link
              href={account.href}
              className={`hidden sm:inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors max-w-[10rem] ${
                membership.active ? "border-gold/60" : "border-border"
              }`}
            >
              <AccountIcon className="h-4 w-4 shrink-0" />
              <span className="truncate">{account.label}</span>
            </Link>
            <button
              onClick={openCart}
              className="relative inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-all shadow-soft"
            >
              <ShoppingBag className="h-4 w-4" />
              <span className="hidden sm:inline">Cart</span>
              {count > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[11px] font-semibold text-charcoal">
                  {count}
                </span>
              )}
            </button>
            <button
              onClick={() => setOpen((v) => !v)}
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full glass"
              aria-label="Menu"
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="md:hidden mt-2 glass rounded-3xl p-4 animate-fade-up">
            <nav className="flex flex-col gap-1">
              {links.map((l) => (
                <a key={l.href} href={l.href} onClick={() => setOpen(false)} className="px-3 py-3 rounded-xl hover:bg-muted text-foreground">
                  {l.label}
                </a>
              ))}
              <Link href={account.href} onClick={() => setOpen(false)} className="px-3 py-3 rounded-xl hover:bg-muted text-foreground flex items-center gap-2">
                <AccountIcon className="h-4 w-4" /> {account.label}
              </Link>
            </nav>
          </div>
        )}
      </div>
    </header>
  );
}
