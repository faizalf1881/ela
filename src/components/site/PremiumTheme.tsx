"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth-client";

/**
 * Applies the premium (gold) treatment across the whole site while the customer
 * has an active membership. Toggling one class on <html> keeps the change purely
 * cosmetic — the design system, layout and components stay exactly as they are.
 */
export function PremiumTheme() {
  const { membership } = useAuth();
  const active = membership.active;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("premium", active);
    return () => root.classList.remove("premium");
  }, [active]);

  return null;
}
