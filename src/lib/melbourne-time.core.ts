// Melbourne calendar helpers for deadlines (security review, 6 Oct). Pure; handles daylight saving.
import { melbourneMidnight } from "./daily-brief.core";
import { isBusinessDay, melbourneYmd } from "./piesa-windows.core";

export function addYmd(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Last millisecond of a Melbourne calendar day, as an ISO instant. */
export function endOfMelbourneYmd(ymd: string): string {
  return new Date(melbourneMidnight(addYmd(ymd, 1)) - 1).toISOString();
}
/** End of the Melbourne day n calendar days after the Melbourne date of startIso. */
export function addMelbourneCalendarDays(startIso: string, n: number): string {
  return endOfMelbourneYmd(addYmd(melbourneYmd(new Date(startIso)), n));
}
/** End of the Melbourne day n business days (Mon–Fri, excluding Victorian public holidays) after startIso's Melbourne date. */
export function addMelbourneBusinessDays(startIso: string, n: number): string {
  let ymd = melbourneYmd(new Date(startIso));
  let left = n;
  while (left > 0) { ymd = addYmd(ymd, 1); if (isBusinessDay(ymd)) left--; }
  return endOfMelbourneYmd(ymd);
}
/** Date-only interface for office stalls; reuse the existing Victorian calendar. */
export function addVicBusinessDays(fromIso: string, days: number): string {
  if (!Number.isInteger(days) || days < 0 || !Number.isFinite(Date.parse(fromIso))) throw new Error("Invalid business-day input");
  let ymd = fromIso.length === 10 ? fromIso : melbourneYmd(new Date(fromIso));
  for (let left = days; left > 0;) { ymd = addYmd(ymd, 1); if (isBusinessDay(ymd)) left--; }
  return ymd;
}
/** Melbourne midnight at the start of the current Melbourne month, as an ISO instant. */
export function melbourneMonthStart(now = new Date()): string {
  return new Date(melbourneMidnight(`${melbourneYmd(now).slice(0, 7)}-01`)).toISOString();
}
/** THE "today" helper: Melbourne calendar date (YYYY-MM-DD). Never use toISOString().slice(0,10) for "today". */
export function melbourneToday(now: Date = new Date()): string {
  return melbourneYmd(now);
}
