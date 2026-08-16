"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, MessageCircle, Loader2, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth-client";

type Mode = "login" | "signup";

export default function CustomerLoginPage() {
  const router = useRouter();
  const { refresh, user } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [next, setNext] = useState("/");
  const [devHint, setDevHint] = useState(false);
  const [notRegistered, setNotRegistered] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(params.get("next") || "/");
  }, []);

  useEffect(() => {
    if (user?.role === "customer") router.replace(next);
  }, [user, next, router]);

  function switchMode(m: Mode) {
    setMode(m);
    setStep("form");
    setNotRegistered(false);
    setCode("");
  }

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !name.trim()) return toast.error("Please enter your name");
    setLoading(true);
    setNotRegistered(false);
    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.notRegistered) {
          setNotRegistered(true);
          return;
        }
        throw new Error(data.error || "Could not send code");
      }
      setStep("otp");
      setDevHint(data.via === "console");
      toast.success(data.via === "console" ? "OTP generated — check the server console" : "OTP sent to your WhatsApp");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code, name: mode === "signup" ? name : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Invalid code");
      await refresh();
      toast.success(mode === "signup" ? "Account created — welcome to Ela & Co." : "Welcome back to Ela & Co.");
      router.replace(next);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center px-4 py-16" style={{ background: "var(--gradient-hero)" }}>
      <Link href="/" className="absolute top-6 left-6 inline-flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Home
      </Link>

      <div className="w-full max-w-md rounded-3xl bg-card ring-1 ring-border shadow-elegant p-8">
        <div className="flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/ela-logo.jpeg" alt="Ela & Co." className="h-14 w-14 rounded-full object-cover ring-1 ring-gold/40" />
          <h1 className="mt-4 font-serif text-3xl text-foreground">
            {step === "otp" ? "Verify your number" : mode === "login" ? "Customer Login" : "Create your account"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === "otp"
              ? `Enter the 6-digit code sent to ${phone}.`
              : mode === "login"
                ? "Enter your WhatsApp number to log in."
                : "Sign up with your name and WhatsApp number."}
          </p>
        </div>

        {/* Login / Sign Up toggle */}
        {step === "form" && (
          <div className="mt-6 grid grid-cols-2 gap-1 rounded-full bg-muted p-1 text-sm">
            <button
              type="button"
              onClick={() => switchMode("login")}
              className={`rounded-full py-2 font-medium transition-colors ${mode === "login" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}
            >
              Login
            </button>
            <button
              type="button"
              onClick={() => switchMode("signup")}
              className={`rounded-full py-2 font-medium transition-colors ${mode === "signup" ? "bg-card text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground"}`}
            >
              Sign Up
            </button>
          </div>
        )}

        {step === "form" ? (
          <form onSubmit={requestOtp} className="mt-6 space-y-4">
            {mode === "signup" && (
              <label className="block">
                <span className="text-xs text-muted-foreground">Full name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Anjali Nair"
                  required
                  className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
                />
              </label>
            )}
            <label className="block">
              <span className="text-xs text-muted-foreground">WhatsApp number</span>
              <input
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setNotRegistered(false);
                }}
                placeholder="+91 79075 77979"
                inputMode="tel"
                required
                className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
              />
            </label>

            {notRegistered && (
              <div className="rounded-xl border border-gold/40 bg-gold/10 p-3 text-sm text-foreground">
                This mobile number is not registered with us. Please sign up to create a new account.
                <button
                  type="button"
                  onClick={() => switchMode("signup")}
                  className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <UserPlus className="h-4 w-4" /> Sign up
                </button>
              </div>
            )}

            {!notRegistered && (
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
                {mode === "login" ? "Send code" : "Create account"}
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="mt-6 space-y-4">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="••••••"
              inputMode="numeric"
              autoFocus
              className="w-full text-center tracking-[0.5em] text-2xl font-serif rounded-xl border border-input bg-background px-4 py-3 focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
            {devHint && (
              <p className="text-xs text-center text-gold">Dev mode: your OTP was printed in the terminal running the app.</p>
            )}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
              Verify &amp; continue
            </button>
            <button type="button" onClick={() => setStep("form")} className="w-full text-xs text-muted-foreground hover:text-foreground">
              Change number
            </button>
          </form>
        )}

        <div className="mt-8 pt-6 border-t border-border text-center text-xs text-muted-foreground">
          Staff member?{" "}
          <Link href="/staff/login" className="text-forest underline underline-offset-4">
            Admin / Kitchen login
          </Link>
        </div>
      </div>
    </main>
  );
}
