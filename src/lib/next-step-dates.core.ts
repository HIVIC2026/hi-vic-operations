// Book-by dates and the 30-day install countdown for the installer Next step box. Pure.
// The Lead Installer lock is NOT here: it lives in prestart.core.ts (Part 9); screens only show it.
import { addVicBusinessDays, melbourneToday } from "./melbourne-time.core";

export type BookByStep = "ready_check" | "price" | "piesa" | "install";

/**
 * Business days allowed for each step, and where each count starts:
 * ready_check from the day the job is given to the installer, price from the Ready Check done,
 * piesa from acceptance, install from the deposit being paid.
 */
export const BOOK_BY_BUSINESS_DAYS: Record<BookByStep, number> = { ready_check: 5, price: 1, piesa: 2, install: 1 };

/** Melbourne YYYY-MM-DD the step should be booked by. */
export function bookBy(step: BookByStep, fromIso: string): string {
  return addVicBusinessDays(fromIso, BOOK_BY_BUSINESS_DAYS[step]);
}

/** True once the Melbourne day is past the book-by date. */
export function overdue(byYmd: string, now: Date): boolean {
  return melbourneToday(now) > byYmd;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayDiff(fromYmd: string, toYmd: string): number {
  // Calendar-day difference on noon-UTC dates, so no fixed Melbourne offset is involved.
  const a = new Date(`${fromYmd}T12:00:00Z`).getTime();
  const b = new Date(`${toYmd}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function installCountdown(installDeadlineYmd: string | null, now: Date): { daysLeft: number; line: string } | null {
  if (!installDeadlineYmd) return null;
  const daysLeft = dayDiff(melbourneToday(now), installDeadlineYmd);
  const d = new Date(`${installDeadlineYmd}T12:00:00Z`);
  const date = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  const unit = daysLeft === 1 ? "day" : "days";
  return { daysLeft, line: `⏱ ${daysLeft} ${unit} left to install · must be done by ${date} (30 days from the PIESA)` };
}
