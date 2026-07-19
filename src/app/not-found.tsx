import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4" style={{ background: "var(--gradient-hero)" }}>
      <div className="max-w-md text-center">
        <p className="text-sm uppercase tracking-[0.3em] text-gold">Ela &amp; Co.</p>
        <h1 className="mt-4 font-serif text-7xl text-foreground">404</h1>
        <h2 className="mt-2 text-xl text-foreground">This page has wandered off</h2>
        <p className="mt-2 text-sm text-muted-foreground">Return home for freshly plated Kerala meals.</p>
        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-full bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}
