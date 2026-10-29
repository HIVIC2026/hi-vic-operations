// Three approved one-off installer texts (Jo, 24 Oct 2026; built per decision 193), pure wording, keys and timing only.
//  - Decision 79: the owner suggested other Ready Check days → the installer picks one and sets a time.
//  - Decision 82 (installer booked, A): an our-lead Ready Check is booked (either side agreed, or the installer changed it).
//  - Decision 99 (installer day before): the install is tomorrow — job + forms link.
// Each wording is the decisions-log sentence verbatim; the brand prefix is added by `brandSmsBody` in the sender.
// Same shape as decision 186 (`install-clearance.core.ts`): ONE `installer_text_prepared` workflow event per text + key
// is recorded BEFORE anything is sent, the real sender owns idempotency, and held attempts never claim the key (165).
import { melbourneYmd } from "./piesa-windows.core";
import { melbourneHm } from "./daily-mitti-text.core";
import { addYmd } from "./melbourne-time.core";

/** Recorded once per text kind + key BEFORE sending (details: { text, key, ... }). */
export const INSTALLER_TEXT_EVENT = "installer_text_prepared" as const;

export const INSTALLER_TEXT_TYPES = {
  /** Decision 79 — the owner suggested 1–5 other Ready Check days; it is the installer's move. */
  ready_check_days_suggested: "ready_check_days_suggested",
  /** Decision 82 (A) — our-lead Ready Check booked; owner details are on the job page. */
  ready_check_booked_installer: "ready_check_booked_installer",
  /** Decision 99 — the install is tomorrow. */
  install_tomorrow: "install_tomorrow",
} as const;
export type InstallerTextKind = keyof typeof INSTALLER_TEXT_TYPES;

/** Catch-up sweeps look back this far for triggers that happened while the server was not running (hours). */
export const INSTALLER_TEXT_SWEEP_HOURS = 24;

/** Melbourne wall-clock time from which the "Install tomorrow" text may go on the day before (the sender's quiet hours
 *  still apply after 8pm). Decision 99 says "day before" without a time; the afternoon gives the installer the evening
 *  to prepare without waking anyone. */
export const INSTALL_TOMORROW_FROM_HM = "16:00";

// ---- keys (one text per trigger) ----
export const readyCheckDaysSuggestedKey = (jobId: string, triggerEventId: string) => `rc-days-suggested:v1:${jobId}:${triggerEventId}`;
export const readyCheckBookedInstallerKey = (jobId: string, startIso: string) => `rc-booked-installer:v1:${jobId}:${startIso}`;
export const installTomorrowKey = (jobId: string, bookingId: string, startIso: string) => `install-tomorrow:v1:${jobId}:${bookingId}:${melbourneYmd(new Date(startIso))}`;

// ---- Melbourne labels ----
/** "Tuesday 27 October" */
export function melbourneDayDate(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso));
}
/** "9am", "9:30am", "1pm" */
export function melbourneClock(iso: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(/\s/g, "").replace(":00", "").toLowerCase();
}
/** "12 Smith St, Frankston" (street before the first comma + suburb), or null when nothing is known. */
export function installerTextAddress(addressLine: string | null | undefined, suburb: string | null | undefined): string | null {
  const street = addressLine?.split(",")[0]?.trim() || null;
  return [street, suburb?.trim() || null].filter(Boolean).join(", ") || null;
}

// ---- wording (verbatim from docs/JO_DECISIONS_LOG.md; the sender adds "Home Insulation Victoria: ") ----
/** Decision 79 (A). */
export function readyCheckDaysSuggestedText(f: { suburb: string | null; jobNumber: string; link: string }): string {
  return `The owner at ${f.suburb?.trim() || "the property"} (${f.jobNumber}) suggested other days for their Ready Check. Tap to pick one and set a time: ${f.link}`;
}
/** AI replies step 2: the newest office note for the installer (newest first), as " Note: …" (at most 100 characters), or "". */
export const INSTALLER_NOTE_TEXT_MAX = 100;
export function installerNoteSuffix(notes?: string[] | null): string {
  const n = (notes ?? []).map((x) => x.replace(/\s+/g, " ").trim()).find(Boolean);
  if (!n) return "";
  return ` Note: ${n.length > INSTALLER_NOTE_TEXT_MAX ? `${n.slice(0, INSTALLER_NOTE_TEXT_MAX - 1).trimEnd()}…` : n}`;
}
/** Decision 82, installer booked (A). `notes` (newest first): the latest office note is added at the end. */
export function readyCheckBookedInstallerText(f: { startIso: string; address: string | null; jobNumber: string; link: string }, notes?: string[]): string {
  return `Booked: Ready Check ${melbourneDayDate(f.startIso)} ${melbourneClock(f.startIso)}, ${f.address ?? "address on the job"} (${f.jobNumber}). Owner details on the job: ${f.link}${installerNoteSuffix(notes)}`;
}
/** Decision 99, installer day before. */
export function installTomorrowText(f: { startIso: string; address: string | null; jobNumber: string; link: string }): string {
  return `Install tomorrow ${melbourneClock(f.startIso)}, ${f.address ?? "address on the job"} (${f.jobNumber}). Job + forms: ${f.link}`;
}

// ---- timing rules ----
/** The "Install tomorrow" text is due when, in Melbourne, today is the day before the install and it is past the send time. */
export function installTomorrowDue(now: Date, startIso: string, fromHm = INSTALL_TOMORROW_FROM_HM): boolean {
  const today = melbourneYmd(now);
  if (addYmd(today, 1) !== melbourneYmd(new Date(startIso))) return false;
  return melbourneHm(now) >= fromHm;
}
/** The Melbourne day whose installs are "tomorrow" from `now` (for the sweep's booking query). */
export const tomorrowMelbourneYmd = (now: Date) => addYmd(melbourneYmd(now), 1);

// ---- Decision 251: team member added → their single-use login link ----
/** One text per invite link + mobile (a new link, or a corrected number, is a new text; a retry of the same never is). */
export const teamMemberInviteKey = (inviteId: string, mobileE164: string) => `team-member-invite:v1:${inviteId}:${mobileE164}`;
/** Decision 251 draft, approved by Jo as written (decision 252). The sender adds "Home Insulation Victoria: ". */
export function teamMemberInviteText(f: { business: string | null; link: string }): string {
  return `${f.business?.trim() || "Your business"} added you to Home Insulation Victoria. Set up your login: ${f.link}`;
}
/** The /join link the invitee opens (same route the owner's copy of the link uses). */
export const teamMemberJoinLink = (base: string, token: string) => `${base.replace(/\/+$/, "")}/join/${token}`;

// ---- Decision 337 (Jo 25 Oct 2026, route approved): the owner changed a booked visit on My job → the trade is told ----
/** Which visit the owner changed: the Ready Check or install day (the installer offers new times/days) or the safety
 *  check (the booked electrician is released; new times go out as a new offer). */
export type OwnerChangedVisitKind = "ready_check" | "installation" | "assessment";
export const OWNER_CHANGED_VISIT_SMS_TYPE = "owner_changed_visit" as const;
/** One text per trigger event (the owner's change). */
export const ownerChangedVisitKey = (jobId: string, triggerEventId: string) => `owner-changed-visit:v1:${jobId}:${triggerEventId}`;

/** Decision 337 wording (plain; the sender adds "Home Insulation Victoria: "). */
export function ownerChangedVisitText(f: { kind: OwnerChangedVisitKind; suburb: string | null; jobNumber: string; wasIso: string | null; link: string | null }): string {
  const place = `${f.suburb?.trim() || "the property"} (${f.jobNumber})`;
  const was = f.wasIso ? ` on ${melbourneDayDate(f.wasIso)} ${melbourneClock(f.wasIso)}` : "";
  if (f.kind === "assessment") return `The owner at ${place} changed their electrical safety check time, so the booking${was} is cancelled. You don't need to go.`;
  const tail = f.link ? `: ${f.link}` : ".";
  if (f.kind === "ready_check") return `The owner at ${place} changed their Ready Check time, so the booking${was} is cancelled. Please offer them 3 new times${tail}`;
  return `The owner at ${place} changed their install day, so the booking${was} is cancelled. Please offer them 3 new days${tail}`;
}

/** Decision 79 is still worth sending only while it is the installer's move on the owner's days. */
export const daysSuggestedStillCurrent = (turn: string) => turn === "installer_to_answer";
/** Decision 82 is still worth sending only while that start time is the confirmed booking. */
export const bookedStillCurrent = (bookedStartIso: string | null, startIso: string) => !!bookedStartIso && Date.parse(bookedStartIso) === Date.parse(startIso);
