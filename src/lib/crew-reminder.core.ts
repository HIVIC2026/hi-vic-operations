// Crew reminder email (Jo 28 Oct 2026). Pure rules + wording. At 2pm Melbourne time on the day before a booked install
// (booking kind installation, not cancelled) with no `piisa_crew_selected` event, ONE email goes to the installing
// business's email. Once per job + install date; the event is recorded before sending. Nothing else happens if a crew
// still isn't picked. DRAFT wording: no real sends until Jo approves the rendered email.
import { addYmd, melbourneToday } from "./melbourne-time.core";

/** Jo has not approved the rendered email yet: real installers get nothing; TEST uses the existing test-send path. */
export const CREW_REMINDER_EMAIL_APPROVED = false;
export const CREW_REMINDER_EVENT = "crew_reminder_email";
export const CREW_REMINDER_HOUR = 14;

export const crewReminderKey = (jobId: string, installYmd: string) => `crew-reminder:v1:${jobId}:${installYmd}`;

function melbourneHour(now: Date): number {
  const h = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "2-digit", hour12: false }).format(now);
  return Number(h) % 24;
}

/** Install date (Melbourne) for a booking start. */
export const installYmd = (scheduledStartIso: string) => melbourneToday(new Date(scheduledStartIso));

/** Due from 2pm Melbourne on the day before the install, until the end of that day (never on the install day itself). */
export function crewReminderDue(now: Date, scheduledStartIso: string): boolean {
  const day = installYmd(scheduledStartIso);
  return melbourneToday(now) === addYmd(day, -1) && melbourneHour(now) >= CREW_REMINDER_HOUR;
}

export type CrewReminderFacts = {
  bookingKind: string; bookingStatus: string; scheduledStart: string; crewSelected: boolean; alreadySent: boolean; jobDeleted: boolean; businessEmail: string | null;
};
/** Why no reminder (null = send now). */
export function crewReminderBlocker(f: CrewReminderFacts, now: Date): string | null {
  if (f.bookingKind !== "installation") return "not an install booking";
  if (f.bookingStatus === "cancelled") return "booking cancelled";
  if (f.jobDeleted) return "job removed";
  if (!crewReminderDue(now, f.scheduledStart)) return "not due";
  if (f.crewSelected) return "crew already picked";
  if (f.alreadySent) return "already sent for this install date";
  if (!f.businessEmail?.trim()) return "no business email on file";
  return null;
}

/** Draft wording (Jo 28 Oct). */
export function crewReminderEmail(i: { shortAddress: string; address: string; jobLink: string }) {
  return {
    subject: `Pick the crew for tomorrow's install – ${i.shortAddress}`,
    body: `Tomorrow's install at ${i.address} has no Lead installer or crew picked yet. Please pick them on the job page so everyone gets their safety plan and the Mitti form is ready: ${i.jobLink}`,
  };
}
