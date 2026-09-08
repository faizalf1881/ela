import "server-only";
import { prisma } from "./db";

/**
 * Pre-order scheduling. The kitchen runs on India time, but the server runs in
 * UTC on Vercel — every "today" and cut-off comparison below is therefore
 * computed explicitly in Asia/Kolkata so an 8:00 AM cut-off means 8:00 AM in
 * Kerala regardless of where the code executes.
 */
const TZ = "Asia/Kolkata";

/** "YYYY-MM-DD" for a moment, in restaurant-local time. */
export function istDateKey(d: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Minutes past local midnight right now, in restaurant-local time. */
export function istMinutesNow(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD key. */
export function weekdayOf(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

/** Add n days to a YYYY-MM-DD key. */
export function addDays(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Prisma @db.Date round-trips cleanly as UTC midnight of the calendar day. */
export function toDbDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dateKeyFromDb(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function humanDate(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
}

export type SlotDTO = { id: string; label: string; startMinutes: number; endMinutes: number };
export type DayDTO = { date: string; label: string; isToday: boolean; slots: SlotDTO[] };

/**
 * Delivery days + slots a customer may actually pick, honouring the cut-off,
 * the configured service weekdays, and any per-date/per-location slot blocks.
 * Same-day is offered only before the cut-off, and only for slots that start
 * far enough ahead to still be cookable.
 */
export async function getAvailability(locationId?: string | null): Promise<{
  days: DayDTO[];
  cutoffMinutes: number;
  cutoffPassed: boolean;
}> {
  const [setting, slots] = await Promise.all([
    prisma.storeSetting.findUnique({ where: { id: 1 } }),
    prisma.deliverySlot.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { startMinutes: "asc" }] }),
  ]);

  const cutoffMinutes = setting?.orderCutoffMinutes ?? 480;
  const serviceDays = setting?.deliveryDays?.length ? setting.deliveryDays : [0, 1, 2, 3, 4, 5, 6];
  const horizon = Math.max(1, setting?.maxPreorderDays ?? 7);

  const today = istDateKey();
  const nowMinutes = istMinutesNow();
  const cutoffPassed = nowMinutes >= cutoffMinutes;

  const candidates: string[] = [];
  for (let i = 0; i <= horizon; i++) {
    const key = addDays(today, i);
    if (serviceDays.includes(weekdayOf(key))) candidates.push(key);
  }

  // One query for every block in range.
  const blocks = candidates.length
    ? await prisma.slotBlock.findMany({
        where: {
          date: { gte: toDbDate(candidates[0]), lte: toDbDate(candidates[candidates.length - 1]) },
          OR: [{ locationId: null }, ...(locationId ? [{ locationId }] : [])],
        },
      })
    : [];
  const blocked = new Set(blocks.map((b) => `${dateKeyFromDb(b.date)}|${b.slotId}`));

  const days: DayDTO[] = [];
  for (const key of candidates) {
    const isToday = key === today;
    const usable = slots.filter((s) => {
      if (blocked.has(`${key}|${s.id}`)) return false;
      // Same-day only before the cut-off, and only for slots still ahead of us.
      if (isToday && (cutoffPassed || s.startMinutes <= nowMinutes)) return false;
      return true;
    });
    if (usable.length === 0) continue;
    days.push({
      date: key,
      label: isToday ? `Today, ${humanDate(key)}` : humanDate(key),
      isToday,
      slots: usable.map((s) => ({ id: s.id, label: s.label, startMinutes: s.startMinutes, endMinutes: s.endMinutes })),
    });
  }

  return { days, cutoffMinutes, cutoffPassed };
}

/** Server-side guard used when an order is placed. */
export async function assertSlotAvailable(dateKey: string, slotId: string, locationId?: string | null): Promise<string | null> {
  const { days } = await getAvailability(locationId);
  const day = days.find((d) => d.date === dateKey);
  if (!day) return "That delivery date is no longer available. Please pick another.";
  if (!day.slots.some((s) => s.id === slotId)) return "That delivery time is no longer available. Please pick another.";
  return null;
}
