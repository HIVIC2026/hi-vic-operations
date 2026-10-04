// Pure rules for install holds (Operating Model v2, step 9 part A).
// A hold reserves the quoted installer's m2 capacity for a target week. It is NOT an appointment:
// no contact release, not shown to the owner as a booking, and never allows installation.
import { melbourneYmd } from "./piesa-windows.core";

export const HOLD_INITIAL_DAYS_OUT = 21; // before the PIESA is booked: about 3 weeks out
export const HOLD_PIESA_MIN_DAYS = 7; // install falls 7–21 days after the PIESA
export const HOLD_PIESA_MAX_DAYS = 21;
export const HOLD_RELEASE_DAYS = 10; // released if no PIESA booked within 10 days of creation
export const HOLD_WORK_DAYS_PER_WEEK = 5;
export const HOLD_SEARCH_WEEKS = 8;

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
/** Monday of the week containing the date. */
export function mondayOf(ymd: string): string {
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay(); // 0 Sun
  return addDaysYmd(ymd, -((dow + 6) % 7));
}
/** Hold created at quote acceptance + payment gate: week about 3 weeks out. */
export function initialHoldWeek(now: Date): string {
  return mondayOf(addDaysYmd(melbourneYmd(now), HOLD_INITIAL_DAYS_OUT));
}
/** PIESA booked: earliest week so the install can fall 7–21 days after the PIESA. */
export function piesaHoldWeek(piesaStartIso: string): { earliest: string; latest: string } {
  const day = melbourneYmd(new Date(piesaStartIso));
  return { earliest: mondayOf(addDaysYmd(day, HOLD_PIESA_MIN_DAYS)), latest: mondayOf(addDaysYmd(day, HOLD_PIESA_MAX_DAYS)) };
}
/** Rectification needed: the week after the expected rectification date. */
export function rectificationHoldWeek(rectStartIso: string): string {
  return addDaysYmd(mondayOf(melbourneYmd(new Date(rectStartIso))), 7);
}

/** First week from `earliest` (to `latest`, or 8 weeks) where the job's m2 fits the lead installer's capacity.
 * No capacity set → always fits. If nothing fits, the earliest week is kept and flagged over capacity. */
export function chooseHoldWeek(p: { earliest: string; latest?: string | undefined; areaM2: number; dailyCapacityM2: number | null; usedByWeek: Record<string, number> }): { week: string; overCapacity: boolean } {
  if (p.dailyCapacityM2 == null) return { week: p.earliest, overCapacity: false };
  const weekly = p.dailyCapacityM2 * HOLD_WORK_DAYS_PER_WEEK;
  const last = p.latest ?? addDaysYmd(p.earliest, 7 * (HOLD_SEARCH_WEEKS - 1));
  for (let w = p.earliest; w <= last; w = addDaysYmd(w, 7)) {
    if ((p.usedByWeek[w] ?? 0) + p.areaM2 <= weekly) return { week: w, overCapacity: false };
  }
  return { week: p.earliest, overCapacity: true };
}

/** Release when no PIESA has been booked within 10 days of the hold being created. */
export function holdShouldRelease(createdAtIso: string, now: Date, piesaBooked: boolean): boolean {
  if (piesaBooked) return false;
  return now.getTime() - new Date(createdAtIso).getTime() >= HOLD_RELEASE_DAYS * 86_400_000;
}

export function formatHoldWeek(week: string): string {
  return new Date(`${week}T12:00:00Z`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
