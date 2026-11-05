// Deep Part 5a (Jo 4–5 Nov 2026, replaces the Part 9 Task 9 "9am email / 5pm lock" clock): the Lead Installer and the
// install day lock TWO DAYS before the install start — the install's own time of day, two calendar days earlier, Melbourne
// wall-clock (DST-safe) — so Home Insulation Victoria can lodge or update the ESC notice ≥24h before. The reminder clock
// (3 days before, no Lead Installer picked → email to the partner office) and the red Needs me flag (2 days before, still
// none → the office) hang off the same rule. Every installer business, own customers and Home Insulation Victoria leads
// alike. THE ONE rule: re-exported by prestart.core; Part 5 shows it (lockLabel, the "Locked" line), the reminder sweep and
// the Lead/crew/time writers refuse on it. Import-light on purpose (Melbourne day helpers only): the installer home's
// Next step box reads it on first load. PURE: no I/O, no job state — a completed install is the caller's fact.
import { melbourneAt, melbourneYmd } from "./piesa-windows.core";

function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
const TZ = "Australia/Melbourne";
function melbourneParts(d: Date): Record<string, string> {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-AU", { timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(d)) p[x.type] = x.value;
  return p;
}
/** The same Melbourne wall-clock time as `startIso`, `daysBefore` calendar days earlier (whole hour via the DST-safe helper,
 *  minutes added after — neither the lock nor the reminder sits inside a 2–3am DST change). */
function sameTimeDaysBefore(startIso: string, daysBefore: number): Date {
  const start = new Date(startIso);
  const p = melbourneParts(start);
  const day = addDays(melbourneYmd(start), -daysBefore);
  return new Date(melbourneAt(day, Number(p["hour"]) % 24).getTime() + Number(p["minute"]) * 60_000);
}

/** Lead Installer + install day lock: 2 days before the start. Reminder to the partner office when no Lead Installer is picked: 3 days before. */
export const LEAD_LOCK_DAYS_BEFORE = 2;
export const LEAD_REMINDER_DAYS_BEFORE = 3;
/** The line shown on the job once locked and used as the server refusal (Jo 4–5 Nov 2026). Only Home Insulation Victoria's
 *  office can change the Lead Installer or the day after this (the office path in in-house-booking.server / booking.server). */
export const LEAD_LOCKED_MESSAGE = "Locked — call Home Insulation Victoria to change the Lead Installer or the day";
/** `reminderAt` = 3 days before, `lockAt` = 2 days before (both at the install's own time of day, Melbourne, DST-safe), as ISO;
 *  `lockLabel` = "Wed 11 Nov, 7:30am" (the Part 5 screen format "Lead Installer locks …"). */
export function leadInstallerLock(startIso: string): { reminderAt: string; lockAt: string; lockLabel: string } {
  const lockAt = sameTimeDaysBefore(startIso, LEAD_LOCK_DAYS_BEFORE);
  const p = melbourneParts(lockAt);
  const h = Number(p["hour"]) % 24, m = Number(p["minute"]);
  const clock = `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
  return { reminderAt: sameTimeDaysBefore(startIso, LEAD_REMINDER_DAYS_BEFORE).toISOString(), lockAt: lockAt.toISOString(), lockLabel: `${p["weekday"]} ${p["day"]} ${p["month"]}, ${clock}` };
}
/** True from the lock instant on: the Lead Installer (and the install day) can't be changed by the installer any more.
 *  `installCompleted` (the job's installation_completed_at is set): the lock no longer applies — nothing is locked after
 *  the install is done (crew history edits, the completed form). Callers that have the job row pass it. */
export function leadInstallerLocked(startIso: string, now: Date, opts: { installCompleted?: boolean } = {}): boolean {
  if (opts.installCompleted) return false;
  return now.getTime() >= Date.parse(leadInstallerLock(startIso).lockAt);
}
