// Ready Check for installer-supplied customers the installer hasn't quoted (Jo, 7 Oct 6pm). Pure rules only.
// Persistence: installer-ready-check.server.ts. The installer is already assigned from upload, so no offer round
// runs; the job is NEVER offered to another trade.
// Decision 180 (Jo, 24 Oct 2026): the owner "choose 3–5 times" email, its /times link and the waiting/pick states are
// retired — installers arrange their own customers' Ready Checks directly (decisions 110/116: optional visit day and
// time on Add a job / the job screen). Old times-request workflow events stay as history only.

export const BOOK_READY_CHECK = "Book a Ready Check";
export const READY_CHECK_BOOKED = "Ready Check booked";

export type InstallerRcFacts = {
  channel: string | null; stage: string; quoted: "yes" | "no" | null;
  /** Explicit attendance answer; null = not recorded (legacy jobs fall back to the quote answer). */
  attended?: "yes" | "no" | null;
  /** A canonical onsite Ready Check/measurement already exists for this job. */
  onsiteDone?: boolean;
  booked: boolean;
};
export type InstallerRcAction = "none" | "confirm_attendance" | "book" | "booked";

/** What the installer's job page shows for the Ready Check. Only unquoted installer jobs still waiting for one. */
export function installerReadyCheckAction(f: InstallerRcFacts): InstallerRcAction {
  if (f.channel !== "installer_sourced") return "none";
  // Visit needed when the installer says they have NOT attended (even if quoted); attended+unquoted needs no repeat visit.
  // Unknown attendance is never assumed either way: a recorded onsite Ready Check/booking settles it, otherwise ask.
  // A real booking is always shown first: attendance answers never hide, cancel or complete it (office decides).
  if (f.booked || f.stage === "ready_check_scheduled") return "booked";
  if (f.attended === "yes") return "none";
  if (f.attended == null) return f.onsiteDone ? "none" : "confirm_attendance";
  if (f.stage !== "ready_check_ready_to_schedule") return "none";
  return "book";
}

/** Installer-supplied jobs: a Ready Check offer may only ever go to the business that supplied the customer. */
export function installerJobOfferBlocker(job: { channel: string | null; originating_installer_business_id: string | null }, businessId: string): string | null {
  if (job.channel !== "installer_sourced") return null;
  if (!job.originating_installer_business_id || job.originating_installer_business_id !== businessId)
    return "this customer was supplied by another installer — their Ready Check can only go to that installer";
  return null;
}

/** "I'll book it with the owner": a real future date/time, within 90 days. */
export function ownBookingBlocker(startIso: string, now = new Date()): string | null {
  const t = Date.parse(startIso);
  if (!Number.isFinite(t)) return "Enter the date and time you agreed with the owner.";
  if (t <= now.getTime()) return "That time has already passed. Enter the time you agreed with the owner.";
  if (t > now.getTime() + 90 * 86_400_000) return "Ready Checks can be booked up to 90 days ahead.";
  return null;
}
