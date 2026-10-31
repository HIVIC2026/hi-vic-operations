// Decision 327 (Jo, 25 Oct 2026): when the A3 PIESA says the electrician must be on site at the start of the install day
// (decision 314 tick "Be on site at the start of the install day" → official outcome "electrician present at the start of
// installation"; clearance basis `electrician_at_start` in allocation.core), it is lined up AUTOMATICALLY — "the whole point
// of the portal is AUTOMATE — very little office jobs":
//  1. Install day booked (or moved = a new booking) → the assigned electrician is asked ONCE per booking (text + job page):
//     "I'll be there" / "Can't make it".
//  2. "Can't make it" = a reason (Sick / Another job / Too short notice / Other + text) AND 1–5 days they CAN do inside the
//     30-day window. The booked day is released through the existing install-day change path, the installer is told once
//     ("The electrician can't make {day} ({reason}). Offer the owner new install days — they can do: {days}.") and may only
//     offer (and take) those days for this job. When the owner books one of them the electrician is told and auto-confirmed.
//  3. No answer 24h after the request → ONE reminder text; still nothing at 48h → ONE Needs me row. The only other office
//     row: the electrician can do no day inside the window. (The 10-days-left alert stays as it is.)
// It replaces the decision-314 "tell the installer and electrician the day" office line. Price unchanged (inside the one total).
// Pure: decisions, keys, wording, links, answer state, day restriction, reminder and Needs me rules, labels. No I/O.
import { ATTENDANCE_ANCHOR, ATTENDANCE_MAX_DAYS, ATTENDANCE_YES, ATTENDANCE_NO, ATTENDANCE_REASONS, isAttendanceReason, attendanceReasonLabel, declineBlockers, type AttendanceReason } from "./trade-shared-consts.core";
import { onsiteStartTicked, RECTIFICATION_OUTCOMES } from "./official-short.core";
import { melbourneClock, melbourneDayDate } from "./installer-texts.core";
import { melbourneYmd } from "./piesa-windows.core";
import { installDayBounds, OWNER_SUGGEST_MAX } from "./install-days.core";

/** Recorded once per job + install booking BEFORE anything is sent (details: { key, booking_id, start, business_id, to }). */
export const ATTENDANCE_REQUESTED_EVENT = "electrician_install_attendance_requested" as const;
/** The electrician's answers (append-only; the latest answer for the booking wins). Confirmed may be `auto: true` (a day
 *  they said they can do was booked). Declined carries { reason, reason_text, can_do_days, no_days, was }. */
export const ATTENDANCE_CONFIRMED_EVENT = "electrician_install_attendance_confirmed" as const;
export const ATTENDANCE_DECLINED_EVENT = "electrician_install_attendance_declined" as const;
/** The one 24h reminder (recorded before sending; once per booking). */
export const ATTENDANCE_REMINDED_EVENT = "electrician_install_attendance_reminded" as const;
/** The installer told the electrician can't make the day (recorded before sending; once per decline). */
export const ATTENDANCE_INSTALLER_TOLD_EVENT = "electrician_cant_attend_installer_told" as const;
export const ATTENDANCE_EVENTS = [ATTENDANCE_REQUESTED_EVENT, ATTENDANCE_CONFIRMED_EVENT, ATTENDANCE_DECLINED_EVENT, ATTENDANCE_REMINDED_EVENT] as const;
/** The real-sender message types (sms.core SMS_MESSAGE_TYPES): the electrician's request/reminder/booked texts, and the installer's alert. */
export const ATTENDANCE_SMS_TYPE = "electrician_install_attendance" as const;
export const ATTENDANCE_INSTALLER_SMS_TYPE = "electrician_cant_attend_installer" as const;
/** The job-page anchor the text link opens on (InstallAttendanceCard). */
export { ATTENDANCE_ANCHOR };
/** No answer this long after the request → one reminder text. */
export const ATTENDANCE_REMIND_AFTER_MS = 24 * 3_600_000;
/** Still no answer this long after the request → one Needs me row. */
export const ATTENDANCE_OFFICE_AFTER_MS = 48 * 3_600_000;
/** The electrician gives 1–5 days they can do (the same limit as an owner's own days). */
export { ATTENDANCE_MAX_DAYS };

/** Does the stored A3 (short answers) need the electrician on site at the start of the install day? The decision-314 tick,
 *  or the official third outcome it produces (`deriveRectificationOutcome`). */
export function attendanceRequired(short: Record<string, unknown>): boolean {
  return onsiteStartTicked(short) || short["rectificationOutcome"] === RECTIFICATION_OUTCOMES[2];
}

/** One request (and one text) per job + install booking: a moved day is a new booking, so it is asked again. */
export const attendanceKey = (jobId: string, bookingId: string) => `elec-install-attendance:v1:${jobId}:${bookingId}`;
export const attendanceReminderKey = (jobId: string, bookingId: string) => `elec-install-attendance-reminder:v1:${jobId}:${bookingId}`;
export const attendanceInstallerKey = (jobId: string, bookingId: string) => `elec-cant-attend-installer:v1:${jobId}:${bookingId}`;

/** The authenticated electrician job page, scrolled to the attendance card. */
export const attendanceLink = (base: string, jobId: string) => `${base.replace(/\/+$/, "")}/field/${jobId}#${ATTENDANCE_ANCHOR}`;

const addr = (a: string | null | undefined) => a?.trim() || "the property";
const when = (startIso: string) => `${melbourneDayDate(startIso)} at ${melbourneClock(startIso)}`;

/** Decision 327 page line, verbatim: "You're needed at the start of the install at {address} on {day} at {arrival time}." */
export function attendancePageLine(f: { address: string | null; startIso: string }): string {
  return `You're needed at the start of the install at ${addr(f.address)} on ${when(f.startIso)}.`;
}
/** Decision 327 text (Jo approved this route). The sender adds "Home Insulation Victoria: ". */
export function attendanceSmsText(f: { address: string | null; startIso: string; link: string }): string {
  return `You're needed at the start of the install at ${addr(f.address)} on ${when(f.startIso)}. Please confirm on your job page: ${f.link}`;
}
/** The one 24h reminder: the same request, marked as a reminder. */
export const attendanceReminderText = (f: { address: string | null; startIso: string; link: string }) => `Reminder: ${attendanceSmsText(f)}`;
/** The owner booked a day the electrician said they can do → told and auto-confirmed. */
export function attendanceBookedText(f: { address: string | null; startIso: string; link: string }): string {
  return `You're booked at the start of the install at ${addr(f.address)} on ${when(f.startIso)} — a day you said you can do. Job page: ${f.link}`;
}

export type AttendanceRequestFacts = { deleted: boolean; required: boolean; bookingConfirmed: boolean; startAhead: boolean; alreadyRequested: boolean; electricianAssigned: boolean };
/** Why no request goes now for the current install booking (null = record + text). Once per job + booking. */
export function attendanceRequestBlocker(f: AttendanceRequestFacts): string | null {
  if (f.deleted) return "job closed";
  if (!f.required) return "the safety check doesn't need the electrician at the start";
  if (!f.bookingConfirmed) return "no confirmed install day";
  if (!f.startAhead) return "the install day has started";
  if (f.alreadyRequested) return "already asked for this install day";
  if (!f.electricianAssigned) return "no electrician assigned";
  return null;
}

export { ATTENDANCE_YES, ATTENDANCE_NO, ATTENDANCE_REASONS, isAttendanceReason, attendanceReasonLabel, declineBlockers };
export type { AttendanceReason };

/** "Tuesday 28 October, Wednesday 29 October" (sorted). */
export const canDoDaysLabel = (days: string[]) => [...days].sort().map((d) => melbourneDayDate(installDayBounds(d).starts_at)).join(", ");

/** Decision 327 installer alert (text + job page), verbatim: "The electrician can't make {day} ({reason}). Offer the owner
 *  new install days — they can do: {days}." The sender adds "Home Insulation Victoria: ". */
export function installerCantAttendText(f: { wasStartIso: string; reason: string; days: string[] }): string {
  return `The electrician can't make ${melbourneDayDate(f.wasStartIso)} (${f.reason}). Offer the owner new install days — they can do: ${canDoDaysLabel(f.days)}.`;
}

export type AttendanceEv = { job_id: string | null; event_type: string; created_at: string; details?: Record<string, unknown> | null };
export type AttendanceState = "confirmed" | "declined" | "waiting";
const bookingOf = (e: AttendanceEv) => String(e.details?.["booking_id"] ?? "");
const byTime = (a: AttendanceEv, b: AttendanceEv) => a.created_at.localeCompare(b.created_at);

/** The answer state for ONE booking: null = never asked for it; else the latest answer, or waiting. */
export function attendanceState(events: AttendanceEv[], bookingId: string | null | undefined): { state: AttendanceState; requestedAt: string; answeredAt: string | null; reminded: boolean; auto: boolean } | null {
  if (!bookingId) return null;
  const mine = events.filter((e) => bookingOf(e) === bookingId).sort(byTime);
  const req = mine.find((e) => e.event_type === ATTENDANCE_REQUESTED_EVENT);
  if (!req) return null;
  const reminded = mine.some((e) => e.event_type === ATTENDANCE_REMINDED_EVENT);
  const answers = mine.filter((e) => e.event_type === ATTENDANCE_CONFIRMED_EVENT || e.event_type === ATTENDANCE_DECLINED_EVENT);
  const last = answers[answers.length - 1];
  if (!last) return { state: "waiting", requestedAt: req.created_at, answeredAt: null, reminded, auto: false };
  return { state: last.event_type === ATTENDANCE_CONFIRMED_EVENT ? "confirmed" : "declined", requestedAt: req.created_at, answeredAt: last.created_at, reminded, auto: last.details?.["auto"] === true };
}

/** The days this job is limited to: the latest "Can't make it" days, until the electrician later confirms a booking (then
 *  the next change asks them again). null = no limit. A "no days" answer limits nothing (it is an office row). */
export function canDoRestriction(events: AttendanceEv[]): { days: string[]; since: string; bookingId: string } | null {
  const sorted = [...events].sort(byTime);
  const decl = [...sorted].reverse().find((e) => e.event_type === ATTENDANCE_DECLINED_EVENT);
  if (!decl || decl.details?.["no_days"] === true) return null;
  if (sorted.some((e) => e.event_type === ATTENDANCE_CONFIRMED_EVENT && e.created_at > decl.created_at)) return null;
  const days = Array.isArray(decl.details?.["can_do_days"]) ? (decl.details!["can_do_days"] as unknown[]).map(String) : [];
  return days.length ? { days: [...new Set(days)].sort(), since: decl.created_at, bookingId: bookingOf(decl) } : null;
}
/** Install days the installer may offer / the owner may suggest: the window's days, limited to the electrician's days. */
export function restrictInstallDays(allowed: string[], r: { days: string[] } | null): string[] {
  return r ? allowed.filter((d) => r.days.includes(d)) : allowed;
}
/** May this start be booked for this job? (taking an owner's suggested day or any booking under a limit) */
export function dayAllowedByElectrician(startIso: string, r: { days: string[] } | null): boolean {
  return !r || r.days.includes(melbourneYmd(new Date(startIso)));
}
export const ELECTRICIAN_DAYS_ONLY = "The electrician can only do the days they gave — please pick one of those.";

/** The owner booked one of the electrician's days → auto-confirm (they already said they can). */
export const autoConfirmOnBooking = (startIso: string, r: { days: string[] } | null) => !!r && dayAllowedByElectrician(startIso, r);

/** One reminder, 24h after the request, while still unanswered and the booking is current and ahead. */
export function reminderDue(s: ReturnType<typeof attendanceState>, now: Date, startAhead: boolean): boolean {
  return !!s && s.state === "waiting" && !s.reminded && startAhead && now.getTime() - Date.parse(s.requestedAt) >= ATTENDANCE_REMIND_AFTER_MS;
}

/** Decision 327 Needs me line, verbatim (one row per job). */
export const ATTENDANCE_NEEDS_CODE = "electrician_install_attendance" as const;
export const ATTENDANCE_NEEDS_WHY = "Electrician can't attend / hasn't confirmed install-day attendance";
export const attendanceNeedsWhy = (jobNumber: string | null) => `${ATTENDANCE_NEEDS_WHY} – ${jobNumber ?? "job"}`;

export type AttendanceOfficeItem = { jobId: string; since: string; reason: "no_answer" | "no_days"; key: string };
/** At most ONE Needs me row per job:
 *  - no_answer: the job's latest request, for the still-current confirmed install booking, unanswered 48h after it;
 *  - no_days: the electrician's latest "Can't make it" says they can do no day inside the window, and no later booking
 *    has been asked about since.
 *  A later answer, a moved/cancelled day (new booking) or a later request clears it. */
export function attendanceOfficeItems(events: AttendanceEv[], currentBookingIds: ReadonlySet<string>, now: Date): AttendanceOfficeItem[] {
  const byJob = new Map<string, AttendanceEv[]>();
  for (const e of [...events].sort(byTime)) if (e.job_id) byJob.set(e.job_id, [...(byJob.get(e.job_id) ?? []), e]);
  const out: AttendanceOfficeItem[] = [];
  for (const [jobId, evs] of byJob) {
    const key = `${ATTENDANCE_NEEDS_CODE}:${jobId}`;
    const lastReq = [...evs].reverse().find((e) => e.event_type === ATTENDANCE_REQUESTED_EVENT);
    const lastDecl = [...evs].reverse().find((e) => e.event_type === ATTENDANCE_DECLINED_EVENT);
    if (lastDecl && lastDecl.details?.["no_days"] === true && (!lastReq || lastReq.created_at < lastDecl.created_at)) { out.push({ jobId, since: lastDecl.created_at, reason: "no_days", key }); continue; }
    if (!lastReq) continue;
    const bookingId = bookingOf(lastReq);
    if (!bookingId || !currentBookingIds.has(bookingId)) continue;
    const s = attendanceState(evs, bookingId);
    if (s?.state === "waiting" && now.getTime() - Date.parse(s.requestedAt) >= ATTENDANCE_OFFICE_AFTER_MS) out.push({ jobId, since: s.requestedAt, reason: "no_answer", key });
  }
  return out;
}
export const attendanceOfficeDetail = (r: AttendanceOfficeItem["reason"]) =>
  r === "no_days" ? "(the electrician can't do any day left in the 30-day window)" : "(no answer 48 hours after the text and one reminder)";

/** Is an answer allowed? Only the assigned electrician, only for the current booking that was asked about, before it starts. */
export function attendanceAnswerBlocker(f: { electrician: boolean; requested: boolean; bookingCurrent: boolean; startAhead: boolean }): string | null {
  if (!f.electrician) return "Only the electrician on this job can answer.";
  if (!f.requested || !f.bookingCurrent) return "This install day has changed — refresh the page.";
  if (!f.startAhead) return "The install day has already started.";
  return null;
}
