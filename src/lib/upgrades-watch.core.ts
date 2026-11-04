// New job flow, Part 6, Task 7: the upgrades day on the job. Pure rules + wording (APPROVED by Jo 4 Nov 2026 13:55 as drafted:
// the four chasers and the installer warning line) for
// - the install-booking warning when the install is booked before the upgrades day (never a block),
// - the nudge when the upgrades form isn't in: the electrician the day after (from 9am Melbourne), the installer office the day after that,
// - the 30-day red flag: an upgrades day after the 30-day install deadline.
// Every send sits behind its own *_APPROVED = false until go-live flips them; the Needs me row is internal and always on. Sweep: upgrades-watch.server.ts.
import { addYmd } from "./melbourne-time.core";
import { melbourneAt, melbourneYmd } from "./piesa-windows.core";
import { partnerEmailLayout } from "./partner-email.core";

export const UPGRADES_NUDGE_TEXT_APPROVED = true as boolean; // ON at go-live 5 Nov 2026 (Jo approved 4 Nov 13:55)
export const UPGRADES_OFFICE_EMAIL_APPROVED = true as boolean; // ON at go-live 5 Nov 2026
export const UPGRADES_RED_FLAG_EMAIL_APPROVED = true as boolean; // ON at go-live 5 Nov 2026
export const UPGRADES_NUDGE_SMS_TYPE = "upgrades_nudge" as const;

export const UPGRADES_NUDGE_EVENT = "upgrades_nudge";
export const UPGRADES_OFFICE_EMAIL_EVENT = "upgrades_office_email";
/** The red flag (Needs me row, always on): one per job + upgrades day. */
export const UPGRADES_PAST_30_DAYS_EVENT = "upgrades_past_30_days";
/** Recorded (once per key) right before the red-flag email goes; its absence beside a red flag means "still to send" (the tick retries once the flag is on). */
export const UPGRADES_RED_FLAG_EMAIL_EVENT = "upgrades_red_flag_email";
export const OFFICE_COPY_EMAIL = "info@homeinsulationvictoria.com.au";

export const upgradesWatchKeys = (jobId: string, ymd: string) => ({ nudge: `upgrades-nudge:v1:${jobId}:${ymd}`, office: `upgrades-office:v1:${jobId}:${ymd}`, redFlag: `upgrades-red-flag:v1:${jobId}:${ymd}` });

/** "Wed 11 Nov" in Melbourne time. */
export function melbourneDay(iso: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short" }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p["weekday"]} ${p["day"]} ${p["month"]}`;
}
const ymdDay = (ymd: string) => melbourneDay(`${ymd}T12:00:00+10:00`);
const NUDGE_HOUR = 9;

/** DRAFT: the installer sees this when booking the install before the upgrades day. Never blocks the booking. */
export function installBeforeUpgradesWarning(f: { installStart: string; upgradesStart: string | null }): string | null {
  if (!f.upgradesStart) return null;
  const i = Date.parse(f.installStart), u = Date.parse(f.upgradesStart);
  if (!Number.isFinite(i) || !Number.isFinite(u) || i >= u) return null;
  return `The upgrades are booked for ${melbourneDay(f.upgradesStart)}. You can still book the install, but it can't start until the certificate is in.`;
}

/** Who is nudged now: the electrician from 9am Melbourne the day after the upgrades day; the installer office from 9am the day after
 *  that, once the electrician was nudged; nothing once the upgrades form is in. */
export function upgradesNudgeDue(f: { upgradesYmd: string; formDone: boolean; now: Date; nudgedElectrician: boolean; emailedOffice: boolean }): "electrician" | "office" | null {
  if (f.formDone) return null;
  const t = f.now.getTime();
  if (t < melbourneAt(addYmd(f.upgradesYmd, 1), NUDGE_HOUR).getTime()) return null;
  if (!f.nudgedElectrician) return "electrician";
  if (f.emailedOffice || t < melbourneAt(addYmd(f.upgradesYmd, 2), NUDGE_HOUR).getTime()) return null;
  return "office";
}

/** True when the upgrades day is ON or after the 30-day install deadline (both Melbourne dates): the install can't happen
 *  in time, because it needs the upgrades done AND the certificate in first. */
export function upgradesPastWindow(f: { upgradesYmd: string; installDeadlineYmd: string }): boolean {
  return f.upgradesYmd >= f.installDeadlineYmd;
}

export const upgradesYmdOf = (startIso: string) => melbourneYmd(new Date(startIso));

/** DRAFT electrician text (no approved wording yet). */
export function upgradesNudgeText(i: { jobNumber: string; url: string }): string {
  return `Home Insulation Victoria: ${i.jobNumber} upgrades were booked for yesterday. Open your job link to fill in the upgrades form: ${i.url}`;
}
/** The copy kept on the job: the link token is the only credential, so the path is masked. */
export const maskUpgradesLink = (s: string) => s.replace(/(\/e\/)[^\s]+/g, "$1••••");

/** DRAFT installer office email: the upgrades form isn't in the day after the upgrades day. */
export function upgradesOfficeEmail(i: { jobNumber: string; electrician: string; upgradesStart: string; test: boolean }): { subject: string; html: string; text: string } {
  const subject = `${i.jobNumber}: upgrades form not in`;
  const { html, text } = partnerEmailLayout({ subject, blocks: [
    { kind: "p", text: `${i.electrician} had the upgrades for ${i.jobNumber} booked for ${melbourneDay(i.upgradesStart)}, and the upgrades form isn't in yet.` },
    { kind: "p", text: "We've reminded them. Give them a call if you haven't heard — the install can't start until the certificate is in." },
  ], test: i.test });
  return { subject, html, text };
}

/** DRAFT installer office email (copy to info@): the upgrades day is after the 30-day install deadline. */
export function upgradesRedFlagEmail(i: { jobNumber: string; electrician: string; upgradesStart: string; installDeadlineYmd: string; test: boolean }): { subject: string; html: string; text: string } {
  const subject = `${i.jobNumber}: upgrades day is past the 30-day rule`;
  const { html, text } = partnerEmailLayout({ subject, blocks: [
    { kind: "p", text: `The upgrades for ${i.jobNumber} are booked for ${melbourneDay(i.upgradesStart)} with ${i.electrician}. The 30-day install deadline is ${ymdDay(i.installDeadlineYmd)}, so the install can't happen in time (it needs the upgrades done and the certificate in first).` },
    { kind: "p", text: "Please move the upgrades day earlier, or call the office so we can sort out what happens next." },
  ], test: i.test });
  return { subject, html, text };
}
