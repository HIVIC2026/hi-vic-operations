// New job flow Part 9 Task 9 (Jo 2 Nov 2026, "Lead Installer / ESC 24h rule"): the Lead Installer lock clock — THE ONE rule.
// Re-exported by prestart.core (the plan's home for it); Part 5 shows it (lockLabel, the "Locked" line), Part 7 sends the
// 9am email and refuses the Lead/crew/time writers. Import-light on purpose (Melbourne day helpers only): the installer
// home's Next step box reads it on first load. PURE: no I/O, no job state — a completed install is the caller's fact.
import { melbourneAt, melbourneYmd } from "./piesa-windows.core";

function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

/** ESC must know the Lead Installer ≥24h before the install: ONE office email at 9am TWO days before, locked from 5pm that day. */
export const LEAD_CONFIRM_EMAIL_HOUR = 9;
export const LEAD_LOCK_HOUR = 17;
export const LEAD_LOCK_DAYS_BEFORE = 2;
/** The approved line (decisions file; plan Task 9), shown on the job and used as the server refusal. */
export const LEAD_LOCKED_MESSAGE = "Locked: ESC has been told. Email us to move this install.";
/** The 9am email instant and the 5pm lock instant (Melbourne wall-clock, two calendar days before the install's Melbourne
 *  day; DST-safe), as ISO; `lockLabel` = "Wed 11 Nov, 5pm" (the approved Part 5 screen format "Lead Installer locks …"). */
export function leadInstallerLock(startIso: string): { emailAt: string; lockAt: string; lockLabel: string } {
  const day = addDays(melbourneYmd(new Date(startIso)), -LEAD_LOCK_DAYS_BEFORE);
  const lockAt = melbourneAt(day, LEAD_LOCK_HOUR);
  const dayLabel = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" }).format(lockAt).replace(",", "");
  const lockLabel = `${dayLabel}, ${LEAD_LOCK_HOUR % 12}${LEAD_LOCK_HOUR >= 12 ? "pm" : "am"}`;
  return { emailAt: melbourneAt(day, LEAD_CONFIRM_EMAIL_HOUR).toISOString(), lockAt: lockAt.toISOString(), lockLabel };
}
/** True from the lock instant on: the Lead Installer (and the install day) can't be changed by the installer any more.
 *  `installCompleted` (the job's installation_completed_at is set): the lock no longer applies — nothing is locked after
 *  the install is done (crew history edits, the completed form). Callers that have the job row pass it. */
export function leadInstallerLocked(startIso: string, now: Date, opts: { installCompleted?: boolean } = {}): boolean {
  if (opts.installCompleted) return false;
  return now.getTime() >= Date.parse(leadInstallerLock(startIso).lockAt);
}

