// Install days (Jo 24 Oct 2026). Pure rules only.
// Once electrical clearance is in, the quoted installer offers 3 whole install days (8am–4pm Melbourne) inside the
// 30-day window. The owner takes one (booked) or suggests their own days; the installer takes one of those (booked) or
// offers 3 new ones, back and forth until a day is agreed. The office is never involved, except one alert when 10 days
// are left with nothing booked. Days are business days at least 24h away (trades manage their own diaries).
import { isBusinessDay, melbourneAt, melbourneYmd } from "./piesa-windows.core";

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

/** Jo 24 Oct: the installer selects the arrival time for each offered day (exact time, no window). */
export const INSTALL_TIMES = ["06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30", "14:00"] as const;
export type InstallTime = (typeof INSTALL_TIMES)[number];
export const isInstallTime = (t: string): t is InstallTime => (INSTALL_TIMES as readonly string[]).includes(t);

/** The Melbourne instant for a day + "HH:MM" arrival time. */
export function installStartAt(ymd: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(melbourneAt(ymd, h!).getTime() + (m ?? 0) * 60_000);
}

/** Proposal bounds. Without a time (owner-suggested days) the day reads from 8am; the installer sets the time on taking it. */
export function installDayBounds(ymd: string, time?: string): { starts_at: string; ends_at: string } {
  return { starts_at: (time ? installStartAt(ymd, time) : melbourneAt(ymd, INSTALL_DAY_START_HOUR)).toISOString(), ends_at: melbourneAt(ymd, INSTALL_DAY_END_HOUR).toISOString() };
}

/** "6:30am" style label for an INSTALL_TIMES value. */
export function installTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""}${h! < 12 ? "am" : "pm"}`;
}

/** Days the owner may choose: business days, 24h+ away, on or before the deadline. Trades manage their own diaries — no capacity check. */
export function allowedInstallDays(i: { now?: Date; deadline: string | null }): string[] {
  if (!i.deadline) return [];
  const now = i.now ?? new Date();
  const out: string[] = [];
  for (let d = melbourneYmd(now); d <= i.deadline; d = addDays(d, 1)) {
    if (!isBusinessDay(d)) continue;
    if (melbourneAt(d, INSTALL_DAY_START_HOUR).getTime() < now.getTime() + INSTALL_DAY_LEAD_HOURS * 3600_000) continue;
    out.push(d);
  }
  return out;
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

/** Jo 24 Oct: the installer offers 3 days (or every day left, when fewer than 3 remain). */
export const INSTALLER_OFFER_DAYS = 3;
/** The owner may suggest 1–5 days of their own. */
export const OWNER_SUGGEST_MAX = 5;

export type InstallDayRow = { id: string; proposer_role: string | null; status: string; starts_at: string };
export type InstallDayTurn = "not_ready" | "expired" | "booked" | "installer_to_offer" | "owner_to_answer" | "installer_to_answer";

/** Whose move it is. Open = still proposed and not yet passed. Owner rows from before 24 Oct read as the owner's
 *  suggestion, so the installer answers them. */
export function installDayTurn(i: { ready: boolean; booked: boolean; expired: boolean; rows: InstallDayRow[]; now?: Date }): { turn: InstallDayTurn; open: InstallDayRow[] } {
  const now = (i.now ?? new Date()).getTime();
  const open = i.rows.filter((r) => r.status === "proposed" && Date.parse(r.starts_at) > now).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (i.booked) return { turn: "booked", open: [] };
  if (i.expired) return { turn: "expired", open: [] };
  if (!i.ready) return { turn: "not_ready", open: [] };
  if (open.some((r) => r.proposer_role === "installer")) return { turn: "owner_to_answer", open: open.filter((r) => r.proposer_role === "installer") };
  if (open.length) return { turn: "installer_to_answer", open };
  return { turn: "installer_to_offer", open: [] };
}

/** Days offered or suggested: unique, all allowed; installer exactly 3 (or all left), owner 1–5. */
export function dayOfferBlockers(picks: string[], allowed: string[], who: "installer" | "owner"): string[] {
  const b: string[] = [];
  const uniq = new Set(picks);
  if (uniq.size !== picks.length) b.push("Each day can only be chosen once.");
  if (who === "installer") {
    const need = Math.min(INSTALLER_OFFER_DAYS, allowed.length);
    if (need === 0) b.push("There are no days left inside the 30-day window.");
    else if (uniq.size !== need) b.push(need === INSTALLER_OFFER_DAYS ? `Please choose ${INSTALLER_OFFER_DAYS} days.` : `Please choose all ${need} days that are left.`);
  } else {
    if (uniq.size < 1) b.push("Please choose at least 1 day.");
    if (uniq.size > OWNER_SUGGEST_MAX) b.push(`Please choose no more than ${OWNER_SUGGEST_MAX} days.`);
  }
  if ([...uniq].some((d) => !allowed.includes(d))) b.push("One of those days is no longer available. Please choose again.");
  return b;
}

export const NEW_PIESA_NEEDED = "New PIESA needed";
/** "Tuesday 27 October at 7:30am" (installer's day and time), or the day only for an owner-suggested day. */
export function formatInstallDay(startIso: string, withTime = true): string {
  const d = new Date(startIso);
  const day = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" }).format(d);
  if (!withTime) return day;
  const t = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s/g, "").replace(":00", "").toLowerCase();
  return `${day} at ${t}`;
}
