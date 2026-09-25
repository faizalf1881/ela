"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, X, Loader2, AlertTriangle, SwitchCamera, CheckCircle2, XCircle, Info } from "lucide-react";

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts?: { formats?: string[] }): BarcodeDetectorLike;
    };
  }
}

type Status = "starting" | "scanning" | "denied" | "unavailable" | "error";

/** What the scanner shows after a code was handled (continuous mode). */
export type ScanFeedback = { tone: "success" | "info" | "error"; title: string; detail?: string };

// Continuous mode: a label that stays in view (or was just handled) must not be
// processed again. It is accepted again only after leaving the frame for
// ABSENT_MS *and* at least REPEAT_MS after it was last handled.
const ABSENT_MS = 4_000;
const REPEAT_MS = 15_000;
const FEEDBACK_MS = 1_600;

/**
 * Live camera QR scanner for the Orders board. Uses the browser's native
 * BarcodeDetector where available (Android Chrome) and falls back to jsQR frame
 * decoding elsewhere (iOS Safari), so staff can scan delivery labels from a phone.
 */
export function CameraScanner({
  onCode,
  onClose,
  continuous = false,
}: {
  onCode: (code: string) => void | Promise<void | ScanFeedback>;
  onClose: () => void;
  /** Keep scanning label after label, showing each result, instead of closing. */
  continuous?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);
  const handledRef = useRef(false);
  const pausedRef = useRef(false);
  const seenRef = useRef(new Map<string, { lastSeen: number; handledAt: number }>());
  // Latest callbacks in refs: the parent re-renders on every poll, and a new
  // callback identity must not restart the camera.
  const onCodeRef = useRef(onCode);
  const onCloseRef = useRef(onClose);
  onCodeRef.current = onCode;
  onCloseRef.current = onClose;

  const [status, setStatus] = useState<Status>("starting");
  const [message, setMessage] = useState("");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [attempt, setAttempt] = useState(0);
  const [feedback, setFeedback] = useState<ScanFeedback | null>(null);
  const [busy, setBusy] = useState(false);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const handleHit = useCallback(
    async (code: string) => {
      if (!continuous) {
        if (handledRef.current) return;
        handledRef.current = true;
        stop();
        await onCodeRef.current(code);
        onCloseRef.current();
        return;
      }

      const now = Date.now();
      const seen = seenRef.current.get(code);
      if (seen) {
        const stillInView = now - seen.lastSeen < ABSENT_MS;
        const tooSoon = now - seen.handledAt < REPEAT_MS;
        seen.lastSeen = now;
        if (stillInView || tooSoon) return; // same label, not a new scan
      }
      if (pausedRef.current) return;

      pausedRef.current = true;
      seenRef.current.set(code, { lastSeen: now, handledAt: now });
      setBusy(true);
      try {
        const fb = await onCodeRef.current(code);
        setFeedback(fb || { tone: "success", title: "Scanned" });
      } catch (e) {
        setFeedback({ tone: "error", title: e instanceof Error ? e.message : "Scan failed" });
      } finally {
        setBusy(false);
      }
      setTimeout(() => {
        setFeedback(null);
        pausedRef.current = false;
      }, FEEDBACK_MS);
    },
    [continuous, stop],
  );

  useEffect(() => {
    let cancelled = false;

    async function detectLoop() {
      if (!videoRef.current) return;

      // Native detector is fastest; jsQR covers browsers without it.
      let detector: BarcodeDetectorLike | null = null;
      if (typeof window !== "undefined" && window.BarcodeDetector) {
        try {
          detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          detector = null;
        }
      }
      const jsQR = detector ? null : (await import("jsqr")).default;

      const tick = async () => {
        if (cancelled || handledRef.current) return;
        const v = videoRef.current;
        if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
          try {
            if (detector) {
              const hits = await detector.detect(v);
              if (hits[0]?.rawValue) {
                void handleHit(hits[0].rawValue.trim());
                if (!continuous) return;
              }
            } else if (jsQR) {
              const canvas = canvasRef.current;
              const ctx = canvas?.getContext("2d", { willReadFrequently: true });
              if (canvas && ctx) {
                // Downscale for speed: QR stays readable around 480px wide.
                const scale = Math.min(1, 480 / (v.videoWidth || 480));
                canvas.width = Math.max(1, Math.floor((v.videoWidth || 480) * scale));
                canvas.height = Math.max(1, Math.floor((v.videoHeight || 360) * scale));
                ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
                if (hit?.data) {
                  void handleHit(hit.data.trim());
                  if (!continuous) return;
                }
              }
            }
          } catch {
            // One bad frame is not fatal - keep scanning.
          }
        }
        rafRef.current = requestAnimationFrame(() => void tick());
      };
      rafRef.current = requestAnimationFrame(() => void tick());
    }

    async function start() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setStatus("unavailable");
        setMessage(
          typeof window !== "undefined" && window.isSecureContext === false
            ? "Camera needs a secure (https) connection. Open the admin panel over https and try again."
            : "This browser does not support camera access. Use a hardware scanner, or type the code instead.",
        );
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("scanning");
        void detectLoop();
      } catch (e) {
        const name = (e as { name?: string })?.name || "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setMessage("Camera permission was denied. Allow camera access for this site in your browser settings, then try again.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setStatus("error");
          setMessage("No camera found on this device.");
        } else {
          setStatus("error");
          setMessage("Could not start the camera. Close any other app using it, then try again.");
        }
      }
    }

    void start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing, attempt, handleHit, stop, continuous]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-card shadow-elegant" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Camera className="h-4 w-4 text-forest" />
            <span className="font-medium text-foreground">Scan delivery label</span>
          </div>
          <div className="flex items-center gap-1">
            {status === "scanning" && (
              <button
                onClick={() => {
                  stop();
                  setStatus("starting");
                  setFacing((f) => (f === "environment" ? "user" : "environment"));
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted"
                title="Switch camera"
              >
                <SwitchCamera className="h-4 w-4" />
              </button>
            )}
            <button onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-muted" aria-label="Close scanner">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative aspect-[4/3] bg-charcoal">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />

          {status === "scanning" && (
            <>
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-48 w-48 rounded-2xl border-2 border-gold/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
              <div className="absolute inset-x-0 bottom-3 text-center text-xs text-white/90">
                Point the camera at the QR code on the label
              </div>
            </>
          )}

          {status === "scanning" && (busy || feedback) && (
            <div
              role="status"
              aria-live="assertive"
              className={`absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center text-white ${
                busy ? "bg-black/55" : feedback?.tone === "success" ? "bg-green-700/90" : feedback?.tone === "info" ? "bg-amber-600/90" : "bg-red-700/90"
              }`}
            >
              {busy ? (
                <Loader2 className="h-10 w-10 animate-spin" />
              ) : feedback?.tone === "success" ? (
                <CheckCircle2 className="h-14 w-14" />
              ) : feedback?.tone === "info" ? (
                <Info className="h-14 w-14" />
              ) : (
                <XCircle className="h-14 w-14" />
              )}
              {feedback && <div className="text-xl font-semibold leading-tight">{feedback.title}</div>}
              {feedback?.detail && <div className="text-sm text-white/90">{feedback.detail}</div>}
            </div>
          )}

          {status === "starting" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/90">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Starting camera...</span>
            </div>
          )}

          {(status === "denied" || status === "unavailable" || status === "error") && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertTriangle className="h-7 w-7 text-gold" />
              <p className="text-sm text-white/90">{message}</p>
              {status !== "unavailable" && (
                <button
                  onClick={() => {
                    setStatus("starting");
                    setAttempt((n) => n + 1);
                  }}
                  className="rounded-full bg-white/90 px-4 py-2 text-xs font-medium text-charcoal"
                >
                  Try again
                </button>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 text-xs text-muted-foreground">
          {continuous
            ? "Each label moves its order to the next step automatically. Hold up the next label when the result clears."
            : "The order opens automatically once a code is recognised."}
        </div>
      </div>
    </div>
  );
}
