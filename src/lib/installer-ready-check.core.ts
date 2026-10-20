// Ready Check for installer-supplied customers the installer hasn't quoted (Jo, 7 Oct 6pm). Pure rules only.
// Persistence: installer-ready-check.server.ts. The installer is already assigned from upload, so no offer round
// runs; the job is NEVER offered to another trade.

export const BOOK_READY_CHECK = "Book a Ready Check";
export const READY_CHECK_BOOKED = "Ready Check booked";
export const WAITING_FOR_OWNER_TIMES = "Waiting for the owner to choose Ready Check times";
export const OWNER_TIMES_READY = "The owner chose times — tap one to book the Ready Check";
export const RC_TIMES_REQUESTED_EVENT = "installer_ready_check_times_requested";
export const RC_TIMES_LINK_PURPOSE = "ready_check_times";
/** DRAFT — Jo must approve the wording before any real owner receives it. */
export const RC_TIMES_EMAIL_VERSION = "installer-rc-times-v1-draft";
export const RC_TIMES_EMAIL_APPROVED = false;

export type InstallerRcFacts = {
  channel: string | null; stage: string; quoted: "yes" | "no" | null;
  /** Explicit attendance answer; null = not recorded (legacy jobs fall back to the quote answer). */
  attended?: "yes" | "no" | null;
  /** A canonical onsite Ready Check/measurement already exists for this job. */
  onsiteDone?: boolean;
  timesRequested: boolean; openWindows: number; booked: boolean;
};
export type InstallerRcAction = "none" | "confirm_attendance" | "book" | "waiting_for_owner" | "pick_owner_time" | "booked";

/** What the installer's job page shows for the Ready Check. Only unquoted installer jobs still waiting for one. */
export function installerReadyCheckAction(f: InstallerRcFacts): InstallerRcAction {
  if (f.channel !== "installer_sourced") return "none";
  // Visit needed when the installer says they have NOT attended (even if quoted); attended+unquoted needs no repeat visit.
  // Unknown attendance is never assumed either way: a recorded onsite Ready Check/booking settles it, otherwise ask.
  if (f.attended === "yes") return "none";
  if (f.attended == null) { if (f.booked || f.stage === "ready_check_scheduled") return "booked"; return f.onsiteDone ? "none" : "confirm_attendance"; }
  if (f.booked || f.stage === "ready_check_scheduled") return "booked";
  if (f.stage !== "ready_check_ready_to_schedule") return "none";
  if (f.openWindows > 0) return "pick_owner_time";
  if (f.timesRequested) return "waiting_for_owner";
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

const first = (n: string | null | undefined) => (n ?? "").trim().split(/\s+/)[0] ?? "";

/** DRAFT owner email (Jo to approve). Names the installer's business so the owner recognises it. */
export function renderRcTimesEmail(v: { ownerName: string | null; installerBusiness: string; link: string }) {
  const hi = first(v.ownerName) ? `Hi ${first(v.ownerName)},` : "Hi,";
  const subject = `${v.installerBusiness} – choose a time for your free Ready Check`;
  const text = `${hi}\n\n${v.installerBusiness} has asked Home Insulation Victoria to arrange your free Home Insulation Ready Check. Please choose 3 to 5 times that suit you, and ${v.installerBusiness} will confirm one.\n\nChoose my times: ${v.link}\n\nKind regards,\nHome Insulation Victoria`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const html = `<p>${esc(hi)}</p><p>${esc(v.installerBusiness)} has asked Home Insulation Victoria to arrange your free Home Insulation Ready Check. Please choose 3 to 5 times that suit you, and ${esc(v.installerBusiness)} will confirm one.</p><p><a href="${esc(v.link)}" style="display:inline-block;padding:12px 20px;border-radius:999px;background:#3C51C4;color:#ffffff;font-weight:700;text-decoration:none">Choose my times</a></p><p>Kind regards,<br>Home Insulation Victoria</p>`;
  return { subject, text, html };
}
