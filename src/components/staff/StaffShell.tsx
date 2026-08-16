"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Loader2, ClipboardList, UtensilsCrossed, Users, ChefHat, BarChart3, ScrollText, MapPin, TicketPercent, Wallet, Contact, Star, LifeBuoy, Crown } from "lucide-react";
import { useAuth, type Role } from "@/lib/auth-client";

const ADMIN_NAV = [
  { href: "/admin", label: "Orders", icon: ClipboardList },
  { href: "/admin/accounts", label: "Accounts", icon: Wallet },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/menu", label: "Menu", icon: UtensilsCrossed },
  { href: "/admin/locations", label: "Locations", icon: MapPin },
  { href: "/admin/coupons", label: "Coupons", icon: TicketPercent },
  { href: "/admin/memberships", label: "Memberships", icon: Crown },
  { href: "/admin/crm", label: "Customers", icon: Contact },
  { href: "/admin/reviews", label: "Reviews", icon: Star },
  { href: "/admin/complaints", label: "Support", icon: LifeBuoy },
  { href: "/admin/staff", label: "Kitchen Staff", icon: Users },
  { href: "/admin/audit", label: "Audit", icon: ScrollText },
];
const KITCHEN_NAV = [{ href: "/kitchen", label: "Kitchen Board", icon: ChefHat }];

export function StaffShell({ allow, children }: { allow: Role[]; children: ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user || !allow.includes(user.role)) {
      router.replace("/staff/login");
    }
  }, [user, loading, allow, router]);

  if (loading || !user || !allow.includes(user.role)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const nav = user.role === "admin" ? ADMIN_NAV : KITCHEN_NAV;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ela-logo.jpeg" alt="Ela & Co." className="h-9 w-9 rounded-full object-cover ring-1 ring-gold/40" />
              <div className="leading-tight">
                <div className="font-serif text-lg text-foreground">Ela &amp; Co.</div>
                <div className="text-[10px] uppercase tracking-[0.24em] text-gold">
                  {user.role === "admin" ? "Admin" : "Kitchen"} Panel
                </div>
              </div>
            </div>

            <nav className="hidden sm:flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
              {nav.map(({ href, label, icon: Icon }) => {
                const active = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                      active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </Link>
                );
              })}
            </nav>

            <button
              onClick={async () => {
                await logout();
                router.push("/staff/login");
              }}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted"
            >
              <LogOut className="h-4 w-4" /> <span className="hidden sm:inline">Log out</span>
            </button>
          </div>

          {/* mobile nav */}
          <nav className="sm:hidden flex items-center gap-1 pb-3 overflow-x-auto">
            {nav.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap ${
                    active ? "bg-primary text-primary-foreground" : "text-foreground/80 bg-muted"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">{children}</main>
    </div>
  );
}
