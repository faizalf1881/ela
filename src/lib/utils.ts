import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format whole rupees as "₹1,234". */
export function inr(rupees: number) {
  return "₹" + Math.round(rupees).toLocaleString("en-IN");
}

/** Heuristic veg/non-veg classification for the food indicator dot. */
export function isVeg(category?: string | null, name?: string | null): boolean {
  const hay = `${category ?? ""} ${name ?? ""}`.toLowerCase();
  return !/\b(non-?veg|chicken|fish|meat|mutton|beef|prawn|egg|kozhi|meen)\b/.test(hay);
}

/** Normalise an Indian phone number to E.164-ish digits (adds 91 if a bare 10-digit). */
export function normalizePhone(raw: string): string | null {
  const digits = (raw || "").replace(/[^\d]/g, "");
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}
