"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Sparkles, Loader2, Save, KeyRound, PlugZap, ShieldCheck, Trash2 } from "lucide-react";

type Provider = "DISABLED" | "OPENAI" | "OLLAMA";
type View = {
  provider: Provider;
  openaiModel: string;
  openaiBaseUrl: string | null;
  keySource: "admin" | "env" | null;
  keyHint: string | null;
  keyUnreadable: boolean;
  ollamaUrl: string | null;
  ollamaModel: string;
  temperature: number;
  instructions: string | null;
};

const MODELS = ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4o", "gpt-4.1", "gpt-5-mini"];
const TONES = [
  { v: 0.2, label: "Precise" },
  { v: 0.4, label: "Balanced" },
  { v: 0.7, label: "Chatty" },
];

/** AI assistant provider settings (spec #43). */
export function AiSettings() {
  const [v, setV] = useState<View | null>(null);
  const [provider, setProvider] = useState<Provider>("DISABLED");
  const [key, setKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [baseUrl, setBaseUrl] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [ollamaModel, setOllamaModel] = useState("llama3.1");
  const [temperature, setTemperature] = useState(0.3);
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);

  function apply(d: View) {
    setV(d);
    setProvider(d.provider);
    setModel(d.openaiModel);
    setBaseUrl(d.openaiBaseUrl || "");
    setOllamaUrl(d.ollamaUrl || "");
    setOllamaModel(d.ollamaModel);
    setTemperature(d.temperature);
    setInstructions(d.instructions || "");
  }

  useEffect(() => {
    fetch("/api/admin/ai", { cache: "no-store" })
      .then((r) => r.json())
      .then(apply)
      .catch(() => toast.error("Could not load AI settings"));
  }, []);

  async function save(body: Record<string, unknown>, tag: string, ok: string) {
    setBusy(tag);
    setTest(null);
    try {
      const res = await fetch("/api/admin/ai", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not save");
      apply(d);
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      const res = await fetch("/api/admin/ai/test", { method: "POST" });
      const d = await res.json();
      setTest(d.ok ? { ok: true, text: `${d.provider} answered in ${(d.ms / 1000).toFixed(1)}s.` } : { ok: false, text: d.error || "The provider did not answer." });
    } catch {
      setTest({ ok: false, text: "Could not run the test." });
    } finally {
      setBusy(null);
    }
  }

  if (!v) return <div id="ai" className="h-64 animate-pulse rounded-2xl border border-border bg-card lg:col-span-2" />;

  const saveAll = () =>
    save(
      {
        provider,
        openaiModel: model.trim() || "gpt-4o-mini",
        openaiBaseUrl: baseUrl.trim(),
        ollamaUrl: ollamaUrl.trim(),
        ollamaModel: ollamaModel.trim() || "llama3.1",
        temperature,
        instructions,
        ...(key.trim() ? { openaiKey: key.trim() } : {}),
      },
      "save",
      provider === "DISABLED" ? "AI assistant turned off — chats wait for staff" : "AI assistant settings saved",
    ).then((ok) => ok && setKey(""));

  return (
    <div id="ai" className="scroll-mt-24 rounded-2xl border border-border bg-card p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-violet-500/15 text-violet-700">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-foreground">AI assistant for WhatsApp</div>
            <div className="text-xs text-muted-foreground">Answers customer chats until a team member takes over.</div>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${v.provider === "DISABLED" ? "bg-muted text-muted-foreground" : "bg-violet-500/10 text-violet-700"}`}>
          {v.provider === "DISABLED" ? "Off — every chat goes to staff" : v.provider === "OPENAI" ? `OpenAI · ${v.openaiModel}` : `Ollama · ${v.ollamaModel}`}
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="AI provider">
        {(
          [
            ["DISABLED", "Off", "Staff answer every chat"],
            ["OPENAI", "OpenAI (ChatGPT)", "Hosted by OpenAI"],
            ["OLLAMA", "Ollama", "Your own AI server"],
          ] as const
        ).map(([p, title, sub]) => (
          <button
            key={p}
            role="radio"
            aria-checked={provider === p}
            onClick={() => setProvider(p)}
            className={`rounded-2xl border px-3 py-3 text-left transition-colors ${provider === p ? "border-violet-500 bg-violet-500/5" : "border-border hover:border-violet-400/60"}`}
          >
            <div className="text-sm font-medium text-foreground">{title}</div>
            <div className="text-[11px] text-muted-foreground">{sub}</div>
          </button>
        ))}
      </div>

      {provider === "OPENAI" && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">API key</div>
            {v.keySource === "admin" && (
              <div className="mt-1 flex items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-sm">
                <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                  <KeyRound className="h-3.5 w-3.5" /> Saved: {v.keyHint}
                </span>
                <button onClick={() => save({ openaiKey: "" }, "remove", "API key removed")} disabled={busy !== null} className="inline-flex items-center gap-1 text-xs text-destructive hover:underline">
                  <Trash2 className="h-3 w-3" /> Remove
                </button>
              </div>
            )}
            {v.keySource === "env" && <div className="mt-1 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">Using OPENAI_API_KEY from the server settings.</div>}
            {v.keyUnreadable && (
              <div className="mt-1 rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive">The saved key can&apos;t be read (the server secret changed). Enter it again.</div>
            )}
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              placeholder={v.keySource === "admin" ? "Paste a new key to replace it" : "sk-…"}
              className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
            <p className="mt-1 inline-flex items-start gap-1 text-[11px] text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" /> Stored encrypted. It is never shown again or sent to anyone&apos;s browser.
            </p>
          </div>
          <div className="space-y-3">
            <label className="block">
              <span className="text-xs text-muted-foreground">Model</span>
              <input
                list="ai-models"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
              />
              <datalist id="ai-models">
                {MODELS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <label className="block">
              <span className="text-xs text-muted-foreground">API address (leave blank for OpenAI)</span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
              />
            </label>
          </div>
        </div>
      )}

      {provider === "OLLAMA" && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs text-muted-foreground">Ollama server address</span>
            <input
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              placeholder="https://ai.example.com  (port 11434)"
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
            <span className="mt-1 block text-[11px] text-muted-foreground">Must be reachable from the internet — the website runs on Vercel, not in your shop.</span>
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">Model</span>
            <input
              value={ollamaModel}
              onChange={(e) => setOllamaModel(e.target.value)}
              placeholder="llama3.1"
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
          </label>
        </div>
      )}

      {provider !== "DISABLED" && (
        <div className="mt-4 grid gap-4 md:grid-cols-[auto_1fr]">
          <div>
            <div className="text-xs text-muted-foreground">Style</div>
            <div className="mt-1 flex gap-2">
              {TONES.map((t) => (
                <button
                  key={t.v}
                  onClick={() => setTemperature(t.v)}
                  className={`rounded-xl px-3 py-2 text-sm ${Math.abs(temperature - t.v) < 0.051 ? "bg-violet-600 text-white" : "border border-border hover:bg-muted"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="text-xs text-muted-foreground">Extra guidance (FAQs, today&apos;s specials, tone)</span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="e.g. We don't do bulk catering orders on WhatsApp — ask them to call. Friday is fish day."
              className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            />
          </label>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button onClick={saveAll} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
        </button>
        {v.provider !== "DISABLED" && (
          <button onClick={runTest} disabled={busy !== null} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm hover:bg-muted disabled:opacity-60">
            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Test connection
          </button>
        )}
        {test && <span className={`text-xs ${test.ok ? "text-green-700" : "text-destructive"}`}>{test.text}</span>}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        The assistant only sees the menu, delivery rules and the one customer&apos;s own orders, membership and tickets — never anyone
        else&apos;s, and never staff notes. It hands the chat to a person for complaints, payment or refund problems, cancellations, plan
        changes, or whenever it isn&apos;t sure. Staff can take over any chat at any time.
      </p>
    </div>
  );
}
