"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "customer" | "kitchen" | "admin";
export type ClientUser = {
  sub: string;
  role: Role;
  name?: string;
  phone?: string;
  username?: string;
};

export type Membership = {
  active: boolean;
  planName: string | null;
  discountPercent: number;
  freeDelivery: boolean;
  renewsAt: string | null;
  subscriptionId: string | null;
};

const NO_MEMBERSHIP: Membership = {
  active: false,
  planName: null,
  discountPercent: 0,
  freeDelivery: false,
  renewsAt: null,
  subscriptionId: null,
};

type AuthCtx = {
  user: ClientUser | null;
  membership: Membership;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ClientUser | null>(null);
  const [membership, setMembership] = useState<Membership>(NO_MEMBERSHIP);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json();
      setUser(data.user ?? null);
      setMembership(data.membership ?? NO_MEMBERSHIP);
    } catch {
      setUser(null);
      setMembership(NO_MEMBERSHIP);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setMembership(NO_MEMBERSHIP);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ user, membership, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
