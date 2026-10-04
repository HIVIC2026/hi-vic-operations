// Owner-picked install days (Operating Model v2, step 9 Part B). Pure rules only.
// Owner picks 3–5 whole install days (8am–4pm Melbourne) inside the 30-day window, business days at least
// 24h away, where the quoted installer still has m² capacity. The quoted installer taking one = booked.
import { isBusinessDay, melbourneAt, melbourneYmd } from "./piesa-windows.core";

export const INSTALL_DAY_MIN = 3;
export const INSTALL_DAY_MAX = 5;
export const INSTALL_DAY_LEAD_HOURS = 24;
export const INSTALL_WINDOW_DAYS = 30;
export const INSTALL_TEN_DAYS_LEFT = 10;
export const INSTALL_DAY_START_HOUR = 8;
export const INSTALL_DAY_END_HOUR = 16;

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Last allowed install day: clearance date + 30 days; if the stored PIESA deadline is earlier, it wins. */
export function installWindowDeadline(timingDate: string | null, storedDeadline?: string | null): string | null {
  const own = timingDate ? addDays(timingDate.slice(0, 10), INSTALL_WINDOW_DAYS) : null;
  if (own && storedDeadline) return own < storedDeadline ? own : storedDeadline;
  return own ?? storedDeadline ?? null;
}

export function installDayBounds(ymd: string): { starts_at: string; ends_at: string } {
  return { starts_at: melbourneAt(ymd, INSTALL_DAY_START_HOUR).toISOString(), ends_at: melbourneAt(ymd, INSTALL_DAY_END_HOUR).toISOString() };
}

/** Fits the installer's daily m² capacity? No capacity set = always fits. */
export function dayHasCapacity(capacity: number | null, bookedM2: number, areaM2: number): boolean {
  if (capacity == null) return true;
  return bookedM2 + areaM2 <= capacity;
}

/** Days the owner may choose: business days, 24h+ away, on or before the deadline, within capacity. */
export function allowedInstallDays(i: { now?: Date; deadline: string | null; capacity: number | null; areaM2: number; bookedM2ByDay?: Record<string, number> }): string[] {
  if (!i.deadline) return [];
  const now = i.now ?? new Date();
  const out: string[] = [];
  for (let d = melbourneYmd(now); d <= i.deadline; d = addDays(d, 1)) {
    if (!isBusinessDay(d)) continue;
    if (melbourneAt(d, INSTALL_DAY_START_HOUR).getTime() < now.getTime() + INSTALL_DAY_LEAD_HOURS * 3600_000) continue;
    if (!dayHasCapacity(i.capacity, i.bookedM2ByDay?.[d] ?? 0, i.areaM2)) continue;
    out.push(d);
  }
  return out;
}

export function installDayBlockers(picks: string[], allowed: string[]): string[] {
  const b: string[] = [];
  const uniq = new Set(picks);
  if (uniq.size !== picks.length) b.push("Each day can only be chosen once.");
  if (uniq.size < INSTALL_DAY_MIN) b.push(`Please choose at least ${INSTALL_DAY_MIN} days.`);
  if (uniq.size > INSTALL_DAY_MAX) b.push(`Please choose no more than ${INSTALL_DAY_MAX} days.`);
  if ([...uniq].some((d) => !allowed.includes(d))) b.push("One of those days is no longer available. Please choose again.");
  return b;
}

/** Hard gate: may an install start on this instant? */
export function installDayOutsideWindow(startIso: string, deadline: string | null): boolean {
  return !deadline || melbourneYmd(new Date(startIso)) > deadline;
}

/** Whole calendar days left until the deadline (Melbourne). Negative = expired. */
export function installDaysLeft(deadline: string, now: Date = new Date()): number {
  const a = Date.parse(`${melbourneYmd(now)}T00:00:00Z`), b = Date.parse(`${deadline}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** 10 days or fewer left, not expired, nothing booked, not already flagged. */
export function shouldFlagTenDaysLeft(f: { deadline: string | null; booked: boolean; flaggedAt: string | null; now?: Date }): boolean {
  if (!f.deadline || f.booked || f.flaggedAt) return false;
  const left = installDaysLeft(f.deadline, f.now);
  return left >= 0 && left <= INSTALL_TEN_DAYS_LEFT;
}

export const NEW_PIESA_NEEDED = "New PIESA needed";
export function formatInstallDay(startIso: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" }).format(new Date(startIso)) + " (8am–4pm)";
}
