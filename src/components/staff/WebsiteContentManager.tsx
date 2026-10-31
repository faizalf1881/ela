"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Save, Star, Gift, LayoutTemplate, Phone, ExternalLink, AlertTriangle } from "lucide-react";
import { inr } from "@/lib/utils";
import { effectivePrice } from "@/lib/pricing";
import { FEATURED_LABELS, type FeaturedDish, type HeroStat, type PublicSiteInfo } from "@/lib/site-content";

type Dish = {
  id: string;
  name: string;
  description: string;
  price: number;
  discountPercent: number;
  imageUrl: string | null;
  servingInfo: string | null;
  available: boolean;
  stock: number | null;
  category: string;
};
type Content = {
  featuredItemId: string | null;
  featuredLabel: string;
  featuredNote: string | null;
  promoActive: boolean;
  promoText: string | null;
  promoCode: string | null;
  heroStats: HeroStat[] | null;
  ratingMode: "AUTO" | "CUSTOM" | "HIDDEN";
  ratingValue: string | null;
  ratingNote: string | null;
  deliveryTime: string | null;
  openingHours: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
};
type Data = {
  content: Content | null;
  defaults: { featuredLabel: string; deliveryTime: string; phone: string; email: string; address: string; statLabels: string[]; statValues: string[] };
  menu: Dish[];
  preview: {
    featured: FeaturedDish | null;
    featuredHidden: boolean;
    stats: HeroStat[];
    rating: { value: string; note: string } | null;
    autoRating: { value: string; note: string } | null;
    info: PublicSiteInfo;
  };
};

const field = "mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-gold/60";

/** Admin → Website (spec #6/#7): what customers see on the homepage, without a developer. */
export function WebsiteContentManager() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/site", { cache: "no-store" });
    if (res.ok) setData(await res.json());
    else toast.error("Could not load the website content");
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(key: string, body: Record<string, unknown>, done: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/site", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save");
      setData(d);
      toast.success(done, { description: "The website shows it straight away." });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-foreground">Website</h1>
          <p className="mt-1 text-sm text-muted-foreground">The homepage dish, offers and contact details. Dish prices, photos and availability come from Menu.</p>
        </div>
        <Link href="/" target="_blank" className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm hover:bg-muted">
          <ExternalLink className="h-4 w-4" /> Open website
        </Link>
      </div>

      {!data ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-2xl border border-border bg-card" />
          ))}
        </div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <FeaturedCard data={data} busy={busy === "featured"} onSave={(b) => save("featured", b, "Homepage dish updated")} />
          <PromoCard data={data} busy={busy === "promo"} onSave={(b) => save("promo", b, "Offer banner saved")} />
          <HighlightsCard data={data} busy={busy === "highlights"} onSave={(b) => save("highlights", b, "Highlights saved")} />
          <ContactCard data={data} busy={busy === "contact"} onSave={(b) => save("contact", b, "Contact details saved")} />
        </div>
      )}
    </div>
  );
}

function Card({ icon: Icon, title, sub, children }: { icon: typeof Star; title: string; sub: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-forest/15 text-forest">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="font-medium text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{sub}</div>
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </div>
  );
}

function SaveButton({ busy, onClick, label = "Save" }: { busy: boolean; onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="inline-flex min-h-10 items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {label}
    </button>
  );
}

function FeaturedCard({ data, busy, onSave }: { data: Data; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const c = data.content;
  const [itemId, setItemId] = useState(c?.featuredItemId ?? "");
  const [label, setLabel] = useState(c?.featuredLabel ?? data.defaults.featuredLabel);
  const [note, setNote] = useState(c?.featuredNote ?? "");
  const custom = !(FEATURED_LABELS as readonly string[]).includes(label);
  const dish = data.menu.find((m) => m.id === itemId) ?? null;
  const fallback = data.preview.featured;
  const shown = dish && dish.available ? dish : null;
  const price = shown ? effectivePrice(shown.price, shown.discountPercent) : (fallback?.price ?? 0);
  const soldOut = shown ? shown.stock !== null && shown.stock <= 0 : !!fallback?.soldOut;

  return (
    <Card icon={Star} title="Homepage dish" sub="The dish card on the big photo at the top of the website.">
      <label className="block">
        <span className="text-xs text-muted-foreground">Dish</span>
        <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={field}>
          <option value="">Automatic — the first dish in stock</option>
          {data.menu.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} — {inr(effectivePrice(m.price, m.discountPercent))}
              {!m.available ? " (hidden on menu)" : m.stock !== null && m.stock <= 0 ? " (sold out)" : ""}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className="text-xs text-muted-foreground">Badge</span>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {FEATURED_LABELS.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLabel(l)}
              className={`rounded-full px-3 py-1.5 text-xs ${label === l ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80 hover:bg-secondary"}`}
            >
              {l}
            </button>
          ))}
          <button
            type="button"
            onClick={() => custom || setLabel("")}
            className={`rounded-full px-3 py-1.5 text-xs ${custom ? "bg-primary text-primary-foreground" : "bg-muted text-foreground/80 hover:bg-secondary"}`}
          >
            Your own words…
          </button>
        </div>
        {custom && <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="e.g. Onam Special" className={field} />}
      </div>

      <label className="block">
        <span className="text-xs text-muted-foreground">Description on the card (optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={dish?.description || "Leave blank to use the dish description from the menu"} className={field} />
      </label>

      {dish && !dish.available && (
        <p className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {dish.name} is hidden on the menu, so the website shows {fallback?.name ?? "another dish"} instead. Make it visible in Menu to feature it.
        </p>
      )}

      {/* Preview, built from the same menu data the website uses. */}
      {(shown || fallback) && (
        <div className="relative h-48 overflow-hidden rounded-2xl ring-1 ring-gold/25">
          <Image src={(shown ? shown.imageUrl : fallback?.imageUrl) || "/hero-sadya.jpg"} alt="" fill sizes="400px" className="object-cover" />
          <div className="absolute bottom-3 left-3 right-3 glass rounded-xl p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[9px] uppercase tracking-[0.3em] text-gold">{shown ? label || "…" : "Featured Dish"}</div>
                <div className="truncate font-serif text-lg text-foreground">{shown ? shown.name : fallback?.name}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-serif text-lg text-foreground">{soldOut ? "Sold out" : inr(price)}</div>
                <div className="text-[11px] text-muted-foreground">{shown ? shown.servingInfo : fallback?.servingInfo}</div>
              </div>
            </div>
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{shown ? note.trim() || shown.description : fallback?.description}</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/menu" className="text-xs font-medium text-forest hover:underline">
          Change price, photo or serving in Menu →
        </Link>
        <SaveButton
          busy={busy}
          onClick={() => {
            if (custom && !label.trim()) return toast.error("Write the badge text, or pick one");
            onSave({ featuredItemId: itemId || null, featuredLabel: label.trim() || data.defaults.featuredLabel, featuredNote: note });
          }}
        />
      </div>
    </Card>
  );
}

function PromoCard({ data, busy, onSave }: { data: Data; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const c = data.content;
  const [active, setActive] = useState(c?.promoActive ?? false);
  const [text, setText] = useState(c?.promoText ?? "");
  const [code, setCode] = useState(c?.promoCode ?? "");
  return (
    <Card icon={Gift} title="Offer banner" sub="A highlighted line at the top of the homepage. The WhatsApp assistant mentions it too.">
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" />
        Show the offer on the website
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Offer</span>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={160} placeholder="e.g. Free delivery on orders above ₹500 this weekend" className={field} />
      </label>
      <label className="block">
        <span className="text-xs text-muted-foreground">Coupon code (optional — create it in Coupons so it works at checkout)</span>
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} placeholder="e.g. WEEKEND" className={`${field} font-mono uppercase`} />
      </label>
      {text.trim() && (
        <div className={`flex flex-wrap items-center gap-2 rounded-2xl px-4 py-2.5 text-sm ring-1 ${active ? "bg-gold/20 ring-gold/40" : "bg-muted ring-border opacity-70"}`}>
          <Gift className="h-4 w-4 shrink-0" /> {text.trim()}
          {code.trim() && <span className="rounded-full bg-charcoal px-2.5 py-0.5 font-mono text-xs font-semibold text-ivory">{code.trim()}</span>}
          {!active && <span className="text-xs text-muted-foreground">(hidden)</span>}
        </div>
      )}
      <div className="flex justify-end">
        <SaveButton busy={busy} onClick={() => onSave({ promoActive: active, promoText: text, promoCode: code })} />
      </div>
    </Card>
  );
}

function HighlightsCard({ data, busy, onSave }: { data: Data; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const c = data.content;
  const saved = Array.isArray(c?.heroStats) ? c!.heroStats : [];
  const [stats, setStats] = useState<HeroStat[]>([0, 1, 2].map((i) => ({ value: saved[i]?.value ?? "", label: saved[i]?.label ?? "" })));
  const [mode, setMode] = useState<Content["ratingMode"]>(c?.ratingMode ?? "AUTO");
  const [rValue, setRValue] = useState(c?.ratingValue ?? "");
  const [rNote, setRNote] = useState(c?.ratingNote ?? "");
  const visibleDishes = data.menu.filter((m) => m.available).length;
  const autoValues = [String(visibleDishes), data.defaults.statValues[1], data.preview.info.deliveryTime];

  return (
    <Card icon={LayoutTemplate} title="Homepage highlights" sub="The three numbers under the headline, and the rating badge.">
      <div className="space-y-2">
        {stats.map((s, i) => (
          <div key={i} className="grid grid-cols-[6.5rem_1fr] gap-2">
            <input
              value={s.value}
              onChange={(e) => setStats(stats.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              maxLength={12}
              placeholder={autoValues[i] || "—"}
              aria-label={`Highlight ${i + 1} number`}
              className={field.replace("mt-1 ", "")}
            />
            <input
              value={s.label}
              onChange={(e) => setStats(stats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
              maxLength={40}
              placeholder={data.defaults.statLabels[i]}
              aria-label={`Highlight ${i + 1} caption`}
              className={field.replace("mt-1 ", "")}
            />
          </div>
        ))}
        <p className="text-[11px] text-muted-foreground">Leave a number blank to fill it in automatically (dishes on today&apos;s menu, delivery time).</p>
      </div>

      <div>
        <span className="text-xs text-muted-foreground">Rating badge</span>
        <div className="mt-1.5 space-y-1.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "AUTO"} onChange={() => setMode("AUTO")} />
            From your published reviews{" "}
            <span className="text-muted-foreground">({data.preview.autoRating ? `${data.preview.autoRating.value} · ${data.preview.autoRating.note}` : "no reviews yet — hidden"})</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "CUSTOM"} onChange={() => setMode("CUSTOM")} /> My own figure (e.g. your Google rating)
          </label>
          {mode === "CUSTOM" && (
            <div className="grid grid-cols-[6.5rem_1fr] gap-2 pl-6">
              <input value={rValue} onChange={(e) => setRValue(e.target.value)} maxLength={12} placeholder="4.8 ★" className={field.replace("mt-1 ", "")} />
              <input value={rNote} onChange={(e) => setRNote(e.target.value)} maxLength={60} placeholder="350+ Google reviews" className={field.replace("mt-1 ", "")} />
            </div>
          )}
          <label className="flex items-center gap-2">
            <input type="radio" checked={mode === "HIDDEN"} onChange={() => setMode("HIDDEN")} /> Don&apos;t show a rating
          </label>
        </div>
      </div>
      <div className="flex justify-end">
        <SaveButton
          busy={busy}
          onClick={() => {
            if (mode === "CUSTOM" && !rValue.trim()) return toast.error("Enter the rating to show, e.g. 4.8 ★");
            onSave({ heroStats: stats, ratingMode: mode, ratingValue: rValue, ratingNote: rNote });
          }}
        />
      </div>
    </Card>
  );
}

function ContactCard({ data, busy, onSave }: { data: Data; busy: boolean; onSave: (b: Record<string, unknown>) => void }) {
  const c = data.content;
  const d = data.defaults;
  const [f, setF] = useState({
    deliveryTime: c?.deliveryTime ?? "",
    openingHours: c?.openingHours ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    address: c?.address ?? "",
    instagramUrl: c?.instagramUrl ?? "",
    facebookUrl: c?.facebookUrl ?? "",
    xUrl: c?.xUrl ?? "",
  });
  const input = (k: keyof typeof f, label: string, placeholder: string, max: number) => (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} maxLength={max} placeholder={placeholder} className={field} />
    </label>
  );
  return (
    <Card icon={Phone} title="Delivery & contact" sub="Footer details and the delivery time shown across the site.">
      <div className="grid gap-3 sm:grid-cols-2">
        {input("deliveryTime", "Delivery time", d.deliveryTime, 30)}
        {input("openingHours", "Opening hours (optional)", "e.g. Mon–Sat, 11 AM – 9 PM", 120)}
        {input("phone", "Phone", d.phone, 30)}
        {input("email", "Email", d.email, 120)}
      </div>
      <label className="block">
        <span className="text-xs text-muted-foreground">Address</span>
        <textarea rows={2} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} maxLength={300} placeholder={d.address} className={field} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {input("instagramUrl", "Instagram link", "https://instagram.com/…", 300)}
        {input("facebookUrl", "Facebook link", "https://facebook.com/…", 300)}
        {input("xUrl", "X / Twitter link", "https://x.com/…", 300)}
      </div>
      <p className="text-[11px] text-muted-foreground">Blank fields keep the current details. Social icons only appear for links you add.</p>
      <div className="flex justify-end">
        <SaveButton busy={busy} onClick={() => onSave(f)} />
      </div>
    </Card>
  );
}
