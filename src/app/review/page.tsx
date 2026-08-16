"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Star, Loader2, CheckCircle2 } from "lucide-react";

export default function ReviewCollectionPage() {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || body.trim().length < 4) return toast.error("Please add your name and a few words");
    setLoading(true);
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorName: name.trim(), location: location.trim() || undefined, rating, body: body.trim() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Could not submit");
      setDone(true);
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
        {done ? (
          <div className="text-center">
            <div className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-forest/10">
              <CheckCircle2 className="h-8 w-8 text-forest" />
            </div>
            <h1 className="mt-5 font-serif text-3xl text-foreground">Thank you!</h1>
            <p className="mt-2 text-sm text-muted-foreground">Your review has been received and will appear on our website once approved.</p>
            <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              Back to Ela &amp; Co.
            </Link>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-center text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/ela-logo.jpeg" alt="Ela & Co." className="h-14 w-14 rounded-full object-cover ring-1 ring-gold/40" />
              <h1 className="mt-4 font-serif text-3xl text-foreground">Share your experience</h1>
              <p className="mt-1 text-sm text-muted-foreground">We&apos;d love to hear how your Ela &amp; Co. meal was.</p>
            </div>

            <form onSubmit={submit} className="mt-8 space-y-4">
              <div className="flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                    <Star className={`h-8 w-8 ${n <= rating ? "fill-gold text-gold" : "text-muted-foreground/40"}`} />
                  </button>
                ))}
              </div>
              <label className="block">
                <span className="text-xs text-muted-foreground">Your name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Area (optional)</span>
                <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Trivandrum" className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">Your review</span>
                <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} required className="mt-1 w-full rounded-xl border border-input bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60" />
              </label>
              <button type="submit" disabled={loading} className="w-full inline-flex items-center justify-center gap-2 rounded-full bg-primary px-6 py-3.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Star className="h-4 w-4" />} Submit review
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
