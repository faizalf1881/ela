/**
 * Browser playback for the new-order sound, shared by the staff alert
 * (spec #48–#50) and the customer's order confirmation (spec #51). Client only.
 *
 * Browsers allow sound only after the person has interacted with the page, so:
 * - unlockAudio() is called from a click/keypress to start the AudioContext
 *   (staff screens do this on the first interaction; checkout on "Place order");
 * - the file is decoded once and replayed from memory, which keeps working for
 *   the rest of the session without further gestures;
 * - if Web Audio can't decode the file, an <audio> element is used instead.
 */

let ctx: AudioContext | null = null;
const decoded = new Map<string, Promise<AudioBuffer | null>>();
let element: HTMLAudioElement | null = null;

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Resolves after `p` settles or `ms` passes — resume() can stay pending without a gesture. */
function settle(p: Promise<unknown> | undefined, ms: number) {
  return Promise.race([p?.catch(() => {}), new Promise((r) => setTimeout(r, ms))]);
}

function audioElement(url: string): HTMLAudioElement {
  if (!element) {
    element = new Audio();
    element.preload = "auto";
  }
  const abs = new URL(url, window.location.href).href;
  if (element.src !== abs) element.src = abs;
  return element;
}

/** True once the page may play sound without a fresh click. */
export function audioUnlocked(): boolean {
  return ctx?.state === "running";
}

/** Fetch + decode ahead of time so the first alert plays instantly. */
export function preloadSound(url: string): void {
  const c = context();
  if (!c || decoded.has(url)) return;
  decoded.set(
    url,
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((b) => c.decodeAudioData(b))
      .catch(() => null),
  );
}

/** Call from inside a click/keypress handler. Enables sound for this page. */
export function unlockAudio(url?: string): void {
  const c = context();
  if (c && c.state !== "running") void c.resume().catch(() => {});
  if (!url) return;
  preloadSound(url);
  // iOS Safari: the <audio> fallback must also be started inside the gesture.
  try {
    const el = audioElement(url);
    el.muted = true;
    el.play()
      ?.then(() => {
        el.pause();
        el.currentTime = 0;
        el.muted = false;
      })
      .catch(() => {
        el.muted = false;
      });
  } catch {}
}

/** Plays the sound once. Resolves false if the browser blocked it. */
export async function playSound(url: string): Promise<boolean> {
  const c = context();
  if (c) {
    if (c.state !== "running") await settle(c.resume(), 300);
    if (c.state === "running") {
      preloadSound(url);
      const buf = await decoded.get(url);
      if (buf) {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start();
        return true;
      }
    }
  }
  try {
    const el = audioElement(url);
    el.muted = false;
    el.currentTime = 0;
    await el.play();
    return true;
  } catch {
    return false;
  }
}

// ---- Per-device mute for staff alerts (shared by every staff screen/tab) ----

const MUTE_KEY = "ela.orderAlerts.muted";
const MUTE_EVENT = "ela:alerts-muted";

export function isAlertMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAlertMuted(muted: boolean): void {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, "1");
    else localStorage.removeItem(MUTE_KEY);
  } catch {}
  window.dispatchEvent(new Event(MUTE_EVENT));
}

export function subscribeAlertMuted(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === MUTE_KEY && cb();
  window.addEventListener(MUTE_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(MUTE_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}
