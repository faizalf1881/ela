import { prisma } from "./db";
import { getActiveLocations, getSiteContent, getStoreSetting } from "./menu-cache";
import { publicSiteInfo, type PublicSiteInfo } from "./site-content";

/**
 * Shared data for the text pages (policies, contact, about) that payment
 * gateways and customers expect a shop's website to have.
 */

/** Registered business address, as on the original legal pages (the contact address in Admin → Website may differ). */
export const REGISTERED_ADDRESS = "TC 11/1074, PKRA 130, Nithya Sahayamatha Bhavan, Pattom P.O., Thiruvananthapuram, Kerala — 695004, India";

/** The WhatsApp number customers message (same as the floating button). */
export const WHATSAPP_LINK = `https://wa.me/${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "917907577979"}`;

/** Contact details from Admin → Website, or the built-in ones if the database can't be reached. */
export async function loadSiteInfo(): Promise<PublicSiteInfo> {
  try {
    return publicSiteInfo(await getSiteContent());
  } catch {
    return publicSiteInfo(null);
  }
}

/** The address this site is served on, e.g. "www.elaandco.com". */
export function siteHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://www.elaandco.com").host;
  } catch {
    return "www.elaandco.com";
  }
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeText(minutes: number): string {
  const m = Math.min(Math.max(0, minutes), 1439);
  return `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${m >= 720 ? "PM" : "AM"}`;
}

/** "Monday to Saturday", "every day", or a list — weeks read Monday first. No days set means every day, as at checkout. */
export function daysText(days: number[]): string {
  const set = new Set(days.length ? days : [0, 1, 2, 3, 4, 5, 6]);
  if (set.size === 7) return "every day";
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => set.has(d));
  const pos = order.map((d) => (d + 6) % 7); // Monday = 0 … Sunday = 6
  const unbroken = pos.every((p, i) => i === 0 || p === pos[i - 1] + 1);
  if (unbroken && order.length > 2) return `${DAY_NAMES[order[0]]} to ${DAY_NAMES[order[order.length - 1]]}`;
  const names = order.map((d) => DAY_NAMES[d]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
}

export type DeliveryFacts = {
  areas: { name: string; area: string | null; fee: number }[];
  slots: string[];
  days: string;
  /** Same-day delivery for orders placed before this time; null when there is none. */
  sameDayBefore: string | null;
  preorderDays: number;
};

/** What the Delivery policy states, read from the same settings checkout uses (see getAvailability). */
export async function loadDeliveryFacts(): Promise<DeliveryFacts | null> {
  try {
    const [setting, locations, slots] = await Promise.all([
      getStoreSetting(),
      getActiveLocations(),
      prisma.deliverySlot.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }], select: { label: true } }),
    ]);
    const cutoff = setting?.orderCutoffMinutes ?? 480;
    return {
      areas: locations.map((l) => ({ name: l.name, area: l.area, fee: l.deliveryFee })),
      slots: slots.map((s) => s.label),
      days: daysText(setting?.deliveryDays ?? []),
      sameDayBefore: cutoff > 0 ? timeText(cutoff) : null,
      preorderDays: Math.max(1, setting?.maxPreorderDays ?? 7),
    };
  } catch {
    return null;
  }
}
