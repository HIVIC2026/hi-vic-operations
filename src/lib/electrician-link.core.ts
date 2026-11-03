// Part 2 (Jo 3 Nov 2026): the electrician's no-login link for an installer's own job (/e/<token>). The electrician calls
// the owner, books the safety check (PIESA) on the link, or says "Can't do this one". Pure rules and held wording only;
// persistence in electrician-link.server.ts, sends in own-job-piesa-notices.server.ts.
import { addMelbourneCalendarDays } from "./melbourne-time.core";
import { melbourneMidnight } from "./daily-brief.core";
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

/** A Melbourne date (YYYY-MM-DD) and time (HH:mm) from the page's pickers as an ISO instant; null if either is junk. */
export function melbourneWallToIso(day: string, time: string): string | null {
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !t || Number(t[1]) > 23 || Number(t[2]) > 59) return null;
  const ms = melbourneMidnight(day) + (Number(t[1]) * 60 + Number(t[2])) * 60_000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export const CANT_DO_REASONS = ["busy", "owner_not_answering", "other"] as const;
export type CantDoReason = (typeof CANT_DO_REASONS)[number];
const CANT_DO_LABEL: Record<CantDoReason, string> = { busy: "Too busy", owner_not_answering: "Owner not answering", other: "Other" };
export function cantDoReasonLabel(reason: CantDoReason, note?: string | null): string {
  const n = (note ?? "").replace(/\s+/g, " ").trim();
  return reason === "other" && n ? n : CANT_DO_LABEL[reason];
}

export const OWN_JOB_PIESA_HANDED_BACK_EVENT = "own_job_piesa_handed_back";

// ---------- Held wording (Task 6 collects it for Jo; nothing real goes until she approves) ----------

/** Off until Jo approves the "Safety check to book" office email. */
export const OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED: boolean = false;
/** Off until Jo approves the "Can't do the safety check" office email. */
export const OWN_JOB_PIESA_CANT_DO_EMAIL_APPROVED: boolean = false;

/** The electrician's text (SMS type own_job_piesa_link, wordingApproved:false). */
export function electricianLinkText(i: { installer: string; address: string; url: string }): string {
  return `${i.installer} job: safety check (PIESA) to book at ${i.address}. Call the owner, then book it here: ${i.url}`;
}

/** The installer office: this job's safety check is ready to book. */
export function officeToBookEmail(i: { address: string; electrician: string; booker: PiesaBooker; jobUrl: string }): { subject: string; text: string } {
  const who = i.booker === "office" ? "Please call the owner and book it within 2 business days."
    : i.booker === "electrician" ? `We've sent ${i.electrician} a link to call the owner and book it within 2 business days.`
    : `We've sent ${i.electrician} a link too. Whoever books first, within 2 business days.`;
  return { subject: `Safety check to book for ${i.address}`, text: `The owner has paid. ${who}\nJob page: ${i.jobUrl}` };
}

/** The installer office: the electrician can't do this one. */
export function officeCantDoEmail(i: { address: string; electrician: string; reason: string; jobUrl: string }): { subject: string; text: string } {
  return { subject: `${i.electrician} can't do the safety check for ${i.address}`, text: `Reason: ${i.reason}.\nPick another electrician or book it yourselves on the job page: ${i.jobUrl}` };
}
