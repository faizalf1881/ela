"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, LogIn, Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-client";

export default function StaffLoginPage() {
  const router = useRouter();
  const { refresh, user } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user?.role === "admin") router.replace("/admin");
    else if (user?.role === "kitchen") router.replace("/kitchen");
  }, [user, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid credentials");
      await refresh();
      toast.success("Signed in");
      router.replace(data.user.role === "admin" ? "/admin" : "/kitchen");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center px-4 py-16" style={{ background: "var(--gradient-forest)" }}>
      <Link href="/" className="absolute top-6 left-6 inline-flex items-center gap-2 text-sm text-ivory/70 hover:text-ivory">
        <ArrowLeft className="h-4 w-4" /> Home
      </Link>

      <div className="w-full max-w-md rounded-3xl bg-card ring-1 ring-border shadow-elegant p-8">
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-forest/10 text-forest ring-1 ring-forest/15">
            <ShieldCheck className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-serif text-3xl text-foreground">Staff Login</h1>
          <p className="mt-1 text-sm text-muted-foreground">Admin &amp; kitchen access</p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-xs text-muted-foreground">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoCapitalize="none"
              autoComplete="username"
              required
              className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            Sign in
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-border text-center text-xs text-muted-foreground">
          Are you a customer?{" "}
          <Link href="/login" className="text-forest underline underline-offset-4">
            WhatsApp login
          </Link>
        </div>
      </div>
    </main>
  );
}
