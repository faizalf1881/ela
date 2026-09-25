"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BellRing, Loader2, Play, Upload, RotateCcw, MonitorPlay } from "lucide-react";
import { playSound, unlockAudio } from "@/lib/order-sound";
import { ALERT_CONFIG_EVENT, TEST_ALERT_EVENT } from "@/components/staff/NewOrderAlerts";

type Config = { soundUrl: string; customSound: { url: string; name: string } | null; seconds: number };

const DURATIONS = [5, 8, 10, 15, 20, 30];

/**
 * New-order alert settings (spec #48–#50): the sound played on admin/kitchen
 * screens (and to customers when their order is confirmed, #51), and how long the
 * full-screen alert stays up.
 */
export function OrderAlertSettings() {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [busy, setBusy] = useState<"upload" | "reset" | "seconds" | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCfg(d.orderAlert))
      .catch(() => toast.error("Could not load alert settings"));
  }, []);

  async function save(body: Record<string, unknown>) {
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Could not save");
    setCfg(d.orderAlert);
    window.dispatchEvent(new Event(ALERT_CONFIG_EVENT)); // live screens pick it up
    return d.orderAlert as Config;
  }

  async function upload(file: File) {
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("kind", "sound");
      fd.append("file", file);
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed");
      const next = await save({ orderSoundUrl: d.files[0].url });
      toast.success("New-order sound updated");
      unlockAudio(next.soundUrl);
      void playSound(next.soundUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function resetSound() {
    setBusy("reset");
    try {
      await save({ orderSoundUrl: null });
      toast.success("Back to the built-in chime");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  async function setSeconds(seconds: number) {
    setBusy("seconds");
    try {
      await save({ orderAlertSeconds: seconds });
      toast.success(`Alert stays up for ${seconds} seconds`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(null);
    }
  }

  function preview() {
    if (!cfg) return;
    unlockAudio(cfg.soundUrl);
    void playSound(cfg.soundUrl).then((ok) => !ok && toast.error("The browser blocked the sound. Click the page once and try again."));
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-forest/15 text-forest">
          <BellRing className="h-5 w-5" />
        </div>
        <div>
          <div className="font-medium text-foreground">New-order alert</div>
          <div className="text-xs text-muted-foreground">Sound + full-screen green alert on admin and kitchen screens.</div>
        </div>
      </div>

      {!cfg ? (
        <div className="mt-5 h-24 animate-pulse rounded-xl bg-muted" />
      ) : (
        <div className="mt-5 space-y-5">
          <div>
            <div className="text-xs text-muted-foreground">Sound</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="inline-flex min-h-10 items-center rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
                {cfg.customSound ? cfg.customSound.name : "Built-in chime"}
              </span>
              <button onClick={preview} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted">
                <Play className="h-4 w-4" /> Play
              </button>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
              >
                {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload sound
              </button>
              {cfg.customSound && (
                <button
                  onClick={resetSound}
                  disabled={busy !== null}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
                >
                  {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Use built-in
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/ogg,.mp3,.wav,.m4a,.aac,.ogg"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">MP3 recommended (plays on every browser). Up to 3 MB. Used as-is, also for the customer&apos;s order confirmation.</p>
          </div>

          <div>
            <div className="text-xs text-muted-foreground">Full-screen alert stays up for</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {DURATIONS.map((n) => (
                <button
                  key={n}
                  onClick={() => setSeconds(n)}
                  disabled={busy !== null}
                  aria-pressed={cfg.seconds === n}
                  className={`min-h-10 min-w-12 rounded-xl px-3 py-2 text-sm ${cfg.seconds === n ? "bg-forest text-white" : "border border-border hover:bg-muted"}`}
                >
                  {n}s
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => window.dispatchEvent(new Event(TEST_ALERT_EVENT))}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-forest/40 px-4 py-2 text-sm font-medium text-forest hover:bg-forest/5"
          >
            <MonitorPlay className="h-4 w-4" /> Show a test alert
          </button>

          <p className="text-xs leading-relaxed text-muted-foreground">
            Browsers only play sound after someone has clicked the page once, so a screen that was just opened shows a
            &ldquo;Tap to turn on new-order sound&rdquo; button until then. For an unattended kitchen display, start Chrome with{" "}
            <code className="rounded bg-muted px-1">--autoplay-policy=no-user-gesture-required</code>. Each order alerts once per
            device; refreshing does not replay it.
          </p>
        </div>
      )}
    </div>
  );
}
