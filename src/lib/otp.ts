import "server-only";
import crypto from "node:crypto";

/** 6-digit numeric OTP. */
export function generateOtp(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Deterministic hash of an OTP (peppered with JWT_SECRET) for at-rest comparison. */
export function hashOtp(code: string): string {
  const pepper = process.env.JWT_SECRET || "ela-pepper";
  return crypto.createHmac("sha256", pepper).update(code).digest("hex");
}

export const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
export const OTP_MAX_ATTEMPTS = 5;
