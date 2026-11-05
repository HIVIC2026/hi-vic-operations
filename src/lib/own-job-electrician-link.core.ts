// Join 4 Nov 2026: main's Part 2 (#130/#131) electrician link, renamed from electrician-link.* — Part 6's electrician-link.* (worker_job_links) owns /e/<token> now.
// Part 2 (Jo 3 Nov 2026): the electrician's no-login link for an installer's own job (/e/<token>). The electrician calls
// the owner, books the safety check (PIESA) on the link, or says "Can't do this one". Pure rules and held wording only;
// persistence in electrician-link.server.ts, sends in own-job-piesa-notices.server.ts.
import type { PartnerBlock } from "./partner-email.core";
import { addMelbourneCalendarDays } from "./melbourne-time.core";
import { weekdayDayMonthLabel } from "./owner-email-triggers.core";
import { STAGE_ORDER } from "./workflow";
import type { PiesaBooker } from "./piesa-booker.core";

export const ELECTRICIAN_LINK_DAYS = 30;
export const electricianLinkPath = (token: string) => `/e/${token}`;

export const ELECTRICIAN_LINK_MOVED = "This job has moved to another electrician";
export const LINK_EXPIRED = "This link has expired. Call the installer for a new one.";
export const LINK_INVALID = "This link isn't valid. Check you have the whole link from the text.";
export const LINK_NOT_ASSIGNED = "You're no longer the electrician on this job.";
export const LINK_UNAVAILABLE = "This link isn't working right now. Call the installer.";
export const JOB_NOT_GOING_AHEAD = "This job is no longer going ahead.";

/** Why this link can't be used (null = fine). Revoked wins: a swap or "can't do" revokes the link. */
export function electricianLinkRefusal(f: { found: boolean; revokedAt: string | null; expiresAt: string; now: Date; stillAssigned: boolean }): string | null {
  if (!f.found) return LINK_INVALID;
  if (f.revokedAt) return ELECTRICIAN_LINK_MOVED;
  if (!(Date.parse(f.expiresAt) > f.now.getTime())) return LINK_EXPIRED;
  if (!f.stillAssigned) return LINK_NOT_ASSIGNED;
  return null;
}

/** The ONE next thing the link page shows. Part 3 adds the upgrades and certificate steps. */
export type ElectricianStep = "book_piesa" | "do_piesa_in_mitti" | "done";
export function electricianStep(f: { booked: boolean; piesaDone: boolean }): ElectricianStep {
  if (f.piesaDone) return "done";
  return f.booked ? "do_piesa_in_mitti" : "book_piesa";
}

/** The safety check is done once the job has moved past "PIESA booked" in the normal order. */
export function piesaDoneAtStage(stage: string): boolean {
  const i = STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);
  return i > STAGE_ORDER.indexOf("piesa_scheduled");
}

/** A booking time must be ahead of now and no later than the end of the Melbourne day 30 days after the owner paid. */
export function piesaBookingProblem(startIso: string, now: Date, paidAt: string): string | null {
  const start = Date.parse(startIso);
  if (!Number.isFinite(start)) return "That date and time isn't valid.";
  if (start <= now.getTime()) return "That time has already passed. Pick a time from now on.";
  const last = addMelbourneCalendarDays(paidAt, 30);
  if (start > Date.parse(last)) return `That's more than 30 days after the owner paid. Pick a day on or before ${weekdayDayMonthLabel(last) ?? "the 30th day"}.`;
  return null;
}

const MELB_PARTS = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const melbWall = (ms: number) => { const p = Object.fromEntries(MELB_PARTS.formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return `${p["year"]}-${p["month"]}-${p["day"]} ${p["hour"]}:${p["minute"]}`; };

/** A Melbourne date (YYYY-MM-DD) and time (HH:mm) from the page's pickers as an ISO instant, using the Melbourne offset at
 *  that very moment (daylight saving safe). Null if either is junk, or the time doesn't exist (the skipped hour). */
export function melbourneWallToIso(day: string, time: string): string | null {
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  const [y, m, d] = day.split("-").map(Number);
  const naive = Date.UTC(y!, m! - 1, d!, Number(t[1]), Number(t[2]));
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 10) !== day) return null;
  const want = `${day} ${time}`;
  // Try both offsets Melbourne uses (+10, +11): the one whose instant shows the wanted wall time is right.
  for (const off of [11, 10]) {
    const ms = naive - off * 3_600_000;
    if (melbWall(ms) === want) return new Date(ms).toISOString();
  }
  return null;
}

/** Why a picker date and time can't be used (null = fine). */
export function melbourneWallProblem(day: string, time: string): string | null {
  if (melbourneWallToIso(day, time)) return null;
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  const real = /^\d{4}-\d{2}-\d{2}$/.test(day) && !!t && Number(t[1]) <= 23 && Number(t[2]) <= 59 && !Number.isNaN(Date.parse(`${day}T00:00:00Z`));
  return real ? "That time doesn't exist on this day because the clocks change — pick another time." : "That date and time isn't valid.";
}

export const CANT_DO_REASONS = ["busy", "owner_not_answering", "other"] as const;
export type CantDoReason = (typeof CANT_DO_REASONS)[number];
const CANT_DO_LABEL: Record<CantDoReason, string> = { busy: "Too busy", owner_not_answering: "Owner not answering", other: "Other" };
export function cantDoReasonLabel(reason: CantDoReason, note?: string | null): string {
  const n = (note ?? "").replace(/\s+/g, " ").trim();
  return reason === "other" && n ? n : CANT_DO_LABEL[reason];
}

/** Logged once per hand-over while the office "to book" email is held (wording not approved): the installer wasn't told, so the office calls them. */
export const OWN_JOB_PIESA_INSTALLER_NOT_TOLD_EVENT = "own_job_piesa_installer_not_told";
export const OWN_JOB_PIESA_HANDED_BACK_EVENT = "own_job_piesa_handed_back";

// ---------- Wording approved by Jo 3 Nov 2026 (flags kept so a message can be switched off) ----------

/** "Safety check to book" office email: approved by Jo 3 Nov 2026. */
export const OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED: boolean = true;
/** "Can't do the safety check" office email: approved by Jo 3 Nov 2026. */
export const OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED: boolean = true;

/** "Not booked yet" office email: approved by Jo 3 Nov 2026. */
export const OWN_JOB_PIESA_NOT_BOOKED_EMAIL_APPROVED: boolean = true;

/** The electrician's text (SMS type own_job_piesa_link, wordingApproved:false). */
export function electricianLinkText(i: { installer: string; address: string; url: string; firstName?: string | null }): string {
  // Suite text shape (Jo 5 Nov 2026): the sender adds "Home Insulation Victoria: " in front.
  const hi = (i.firstName ?? "").trim().split(/\s+/)[0] || "there";
  return `Hi ${hi}, ${i.installer} has a safety check (PIESA) for you to book at ${i.address}. Call the owner, then book it here: ${i.url}`;
}

/** One installer-office email in the suite look (Jo 5 Nov 2026): the subject, a big heading, the lines under it, an "action"
 *  line in a box, and the plain text the record keeps. The sender adds "Hi {business}," and the Open the job button. */
export type OfficeEmail = { subject: string; heading: string; lines: string[]; action: string; text: string };
const officeEmail = (subject: string, heading: string, lines: string[], action: string, jobUrl: string): OfficeEmail =>
  ({ subject, heading, lines, action, text: `${[...lines, action].join("\n")}\nJob page: ${jobUrl}` });

/** The installer office: this job's safety check is ready to book. */
export function officeToBookEmail(i: { address: string; electrician: string; booker: PiesaBooker; jobUrl: string }): OfficeEmail {
  const who = i.booker === "office" ? "Please call the owner and book it within 2 business days."
    : i.booker === "electrician" ? `We've sent ${i.electrician} a link to call the owner and book it within 2 business days.`
    : `We've sent ${i.electrician} a link too. Whoever books first, within 2 business days.`;
  return officeEmail(`Safety check to book for ${i.address}`, "Safety check to book", [`The owner at ${i.address} has paid.`], who, i.jobUrl);
}

/** The installer office: the electrician can't do this one. */
export function officeCantDoEmail(i: { address: string; electrician: string; reason: string; jobUrl: string }): OfficeEmail {
  return officeEmail(`${i.electrician} can't do the safety check for ${i.address}`, `${i.electrician} can't do the safety check`, [`${i.address}. Reason: ${i.reason}.`], "Pick another electrician on the job.", i.jobUrl);
}

/** The installer office: 2 business days passed and the safety check still isn't booked. */
export function officeNotBookedEmail(i: { address: string; jobUrl: string }): OfficeEmail {
  return officeEmail("Not booked yet — book it or pick another electrician", "Safety check not booked yet", [`The safety check (PIESA) at ${i.address} isn't booked yet.`], "Book it on the job, or pick another electrician.", i.jobUrl);
}

/** The blocks every installer-office email is laid out from (partnerEmailLayout): greeting, lines, action box, button. */
export function officeEmailBlocks(m: OfficeEmail, business: string | null, jobUrl: string | null): PartnerBlock[] {
  return [
    { kind: "hi", text: business?.trim() ? `Hi ${business.trim()},` : "Hi," },
    ...m.lines.map((t): PartnerBlock => ({ kind: "p", text: t })),
    { kind: "box", text: m.action },
    ...(jobUrl ? [{ kind: "button", label: "Open the job", url: jobUrl } as PartnerBlock] : []),
  ];
}
