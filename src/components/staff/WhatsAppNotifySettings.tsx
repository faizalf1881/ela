"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { MessageCircle, Loader2, Save, RotateCcw, ChevronDown, ScrollText } from "lucide-react";
import { STATUS_LABEL, type OrderStatus } from "@/lib/order-status";

type Status = "PLACED" | "PREPARING" | "OUT_FOR_DELIVERY" | "DELIVERED" | "CANCELLED";
const ORDER: Status[] = ["PLACED", "PREPARING", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"];

type Notify = {
  configured: boolean;
  statuses: Status[];
  custom: Partial<Record<Status, string>>;
  defaults: Record<Status, string>;
  placeholders: string[];
  template: string | null;
  templateLang: string;
};

// What {name} {order} … look like in the preview.
const SAMPLE: Record<string, string> = {
  name: "Anjali",
  order: "#K7Q2ZP",
  invoice: "ELA-00042",
  total: "₹489",
  when: "Sat, 27 Sept, 12:30 PM - 1:00 PM",
  items: "2× Traditional Kerala Meals, 1× Palada Payasam",
};

function preview(text: string) {
  return text
    .split("\n")
    .flatMap((line) => {
      let emptied = false;
      const out = line.replace(/\{(\w+)\}/g, (m, k: string) => {
        if (!(k in SAMPLE)) return m;
        if (!SAMPLE[k]) emptied = true;
        return SAMPLE[k];
      });
      return emptied && /:\s*$/.test(out.trim()) ? [] : [out];
    })
    .join("\n")
    .trim();
}

/** WhatsApp order-update settings (spec #45): which statuses notify, and what they say. */
export function WhatsAppNotifySettings() {
  const [cfg, setCfg] = useState<Notify | null>(null);
  const [open, setOpen] = useState<Status | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<Status, string>>>({});
  const [template, setTemplate] = useState("");
  const [lang, setLang] = useState("en");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setCfg(d.notify);
        setTemplate(d.notify.template || "");
        setLang(d.notify.templateLang || "en");
      })
      .catch(() => toast.error("Could not load WhatsApp settings"));
  }, []);

  async function save(body: Record<string, unknown>, key: string, ok: string) {
    setBusy(key);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save");
      setCfg(d.notify);
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(null);
    }
  }

  const textFor = useMemo(() => (s: Status) => drafts[s] ?? cfg?.custom[s] ?? cfg?.defaults[s] ?? "", [drafts, cfg]);

  if (!cfg) return <div className="h-64 animate-pulse rounded-2xl border border-border bg-card" />;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#25D366]/15 text-[#128C7E]">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">WhatsApp order updates</div>
            <div className="text-xs text-muted-foreground">Sent automatically when an order&apos;s status changes.</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${cfg.configured ? "bg-green-500/15 text-green-700" : "bg-gold/15 text-[oklch(0.52_0.12_75)]"}`}>
            {cfg.configured ? "WhatsApp connected" : "WhatsApp not set up on the server"}
          </span>
          <Link href="/admin/notifications" className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">
            <ScrollText className="h-3.5 w-3.5" /> Message log
          </Link>
        </div>
      </div>

      <div className="mt-5 divide-y divide-border rounded-xl border border-border">
        {ORDER.map((st) => {
          const on = cfg.statuses.includes(st);
          const custom = !!cfg.custom[st];
          const isOpen = open === st;
          return (
            <div key={st} className="p-3">
              <div className="flex items-center gap-3">
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={`Send an update when an order is ${STATUS_LABEL[st as OrderStatus]}`}
                  disabled={busy !== null}
                  onClick={() =>
                    save(
                      { notifyStatuses: on ? cfg.statuses.filter((x) => x !== st) : [...cfg.statuses, st] },
                      `toggle-${st}`,
                      on ? `No update for “${STATUS_LABEL[st as OrderStatus]}”` : `Update on for “${STATUS_LABEL[st as OrderStatus]}”`,
                    )
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${on ? "bg-forest" : "bg-muted-foreground/40"}`}
                >
                  <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">{STATUS_LABEL[st as OrderStatus]}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {custom ? "Custom message" : "Built-in message"} · {preview(textFor(st)).split("\n")[0]}
                  </div>
                </div>
                <button
                  onClick={() => setOpen(isOpen ? null : st)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs hover:bg-muted"
                  aria-expanded={isOpen}
                >
                  Edit <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>
              </div>

              {isOpen && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <textarea
                      value={textFor(st)}
                      onChange={(e) => setDrafts((d) => ({ ...d, [st]: e.target.value }))}
                      rows={6}
                      maxLength={1000}
                      className="w-full rounded-xl border border-input bg-background px-3 py-2.5 font-mono text-[13px] focus:outline-none focus:ring-2 focus:ring-gold/60"
                    />
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Fills in: {cfg.placeholders.map((p) => `{${p}}`).join(" ")} · *bold*
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        disabled={busy !== null}
                        onClick={async () => {
                          if (await save({ notifyMessages: { [st]: textFor(st) } }, `msg-${st}`, "Message saved")) setDrafts(({ [st]: _drop, ...rest }) => rest);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
                      >
                        {busy === `msg-${st}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
                      </button>
                      {(custom || drafts[st] !== undefined) && (
                        <button
                          disabled={busy !== null}
                          onClick={async () => {
                            if (await save({ notifyMessages: { [st]: null } }, `reset-${st}`, "Back to the built-in message")) setDrafts(({ [st]: _drop, ...rest }) => rest);
                          }}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs hover:bg-muted disabled:opacity-60"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> Use built-in
                        </button>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Preview</div>
                    <div className="mt-1 whitespace-pre-wrap rounded-xl rounded-tl-sm bg-[#dcf8c6] px-3 py-2 text-[13px] text-[#111b21] shadow-soft">
                      {preview(textFor(st))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-5 rounded-xl bg-muted/50 p-4">
        <div className="text-sm font-medium text-foreground">Approved template (recommended)</div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          WhatsApp only delivers free-text messages to customers who messaged you in the last 24 hours. For everyone else,
          create a <strong>Utility</strong> template in Meta → WhatsApp Manager → Message templates with this body, then enter
          its name here:
        </p>
        <code className="mt-2 block rounded-lg bg-background px-3 py-2 text-xs text-foreground">
          Hi {"{{1}}"}, here&apos;s an update on your Ela &amp; Co. order {"{{2}}"}: {"{{3}}"}
        </code>
        <p className="mt-1 text-[11px] text-muted-foreground">{"{{1}}"} first name · {"{{2}}"} order number · {"{{3}}"} the message above (on one line)</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            value={template}
            onChange={(e) => setTemplate(e.target.value.trim())}
            placeholder="e.g. order_status_update"
            className="min-w-0 flex-1 rounded-xl border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
          />
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="rounded-xl border border-input bg-background px-3 py-2 text-sm">
            {["en", "en_US", "en_GB", "ml", "hi"].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <button
            disabled={busy !== null}
            onClick={() => save({ waStatusTemplate: template || null, waStatusTemplateLang: lang }, "template", template ? "Template saved" : "Template removed — plain messages only")}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy === "template" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {cfg.template ? `Using template “${cfg.template}” (${cfg.templateLang}), with plain text as a fallback.` : "No template yet: updates are sent as plain messages."}
        </p>
      </div>
    </div>
  );
}
