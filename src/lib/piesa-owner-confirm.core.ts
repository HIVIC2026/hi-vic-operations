// Decision 296 (Jo, 25 Oct 2026: "the owner might not be there"): the owner confirms the PIESA by SECURE LINK, not on the
// electrician's A3 Mitti form. After the electrician completes the PIESA the owner is asked by email (O71) + text, reminded
// on days 1 and 3, and the office is alerted on day 5; the official PIESA owner block (Section 4 / "O": o.tick1–4, o.name,
// o.date) is filled from that record and NEVER from the Mitti form any more; the install day cannot be booked until the
// current PIESA is confirmed. A re-done PIESA (a new `initial` or `reassessment` PIESA record — the same kinds that anchor
// the 30-day window) needs a new confirmation.
// PURE: what the page shows, validation, the append-only record shape, the reminder schedule and the blocker. No I/O.

import { PIESA_FULL } from "./job-wording";
import { OWNER_PIESA_CONFIRM_WAITING } from "./trade-shared-consts.core";

export const PIESA_OWNER_CONFIRM_VERSION = "piesa-owner-confirm-v1";
/** Append-only workflow event: one per owner confirmation of one PIESA record. */
export const PIESA_OWNER_CONFIRMED_EVENT = "piesa_owner_confirmed";
/** One per reminder step (recorded BEFORE anything is sent, so a 15-minute tick never repeats a step). */
export const PIESA_OWNER_CONFIRM_STEP_EVENT = "piesa_owner_confirm_reminder";
/** Day-5 office alert (Needs me row `piesa_owner_unsigned`). */
export const PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT = "piesa_owner_unconfirmed_5_days";
export const PIESA_OWNER_CONFIRM_SMS_TYPE = "piesa_owner_confirm" as const;
/** O71 email wording is a DRAFT (docs/templates/mjml/owner_O71.mjml) until Jo approves it. Real owners get
 *  nothing while false; TEST jobs use test-send. The text has the same status in sms.core (`wordingApproved: false`). */
/** Decision 311 (Jo 25 Oct 2026): O71 approved as drafted (no code, 30-day line). Delivery still behind customer_comms_enabled. */
export const PIESA_OWNER_CONFIRM_EMAIL_APPROVED = true as boolean;
export const PIESA_OWNER_CONFIRM_SMS_APPROVED = true as boolean; // decision 311
export const O71_TEMPLATE_CODE = "O71";

/** The official warning, as a plain sentence (official PIESA owner tick 1 says the same in form language). */
export const CEILING_ENTRY_WARNING = "Anyone going into the ceiling before installation may cancel this assessment.";
/** Blocker text for the office job page / confirmBooking / stageEntryBlockers("installation_booked"). */
export const OWNER_PIESA_CONFIRMATION_BLOCKER = "Owner confirmation of the electrical safety check (PIESA) not signed yet — the install day can't be booked until the owner confirms it on their secure link.";
/** Installer job page "Next" line while the owner has not confirmed. */
export { OWNER_PIESA_CONFIRM_WAITING };
/** Flag the official-form expansion raises when no confirmation record exists for the PIESA being filled. */
export const OWNER_CONFIRMATION_NOT_SIGNED_FLAG = "Owner confirmation not signed";

// ---------- facts ----------
export type PiesaOutcomeKind = "all_clear" | "repair_needed" | "electrician_on_install_day";
export const OUTCOME_LABEL: Record<PiesaOutcomeKind, string> = {
  all_clear: "All clear — your ceiling is safe to insulate",
  repair_needed: "Repair work is needed before the insulation goes in",
  electrician_on_install_day: "An electrician will be present on your install day",
};
export function piesaOutcomeKind(f: { outcome: "pass" | "fail" | null; rectificationRequired: boolean; electricianOnInstallDay: boolean }): PiesaOutcomeKind {
  if (f.electricianOnInstallDay) return "electrician_on_install_day";
  if (f.rectificationRequired || f.outcome === "fail") return "repair_needed";
  return "all_clear";
}

export type OwnerPiesaConfirmation = {
  name: string; authority: "owner" | "authorised_representative"; signedAt: string; piesaRecordId: string; signedCopyId: string | null;
};
export type PiesaOwnerConfirmFacts = {
  /** The electrician's PIESA record being confirmed (latest `initial` or `reassessment` piesa_records row). */
  piesaRecordId: string;
  /** Assessment date (YYYY-MM-DD, Melbourne) and when the record was written (ISO) — the reminder clock starts here. */
  completedDate: string; completedAt: string;
  outcome: "pass" | "fail" | null; rectificationRequired: boolean; electricianOnInstallDay: boolean;
  electrician: { name: string | null; recName: string | null };
  /** The current official signed PIESA copy when one exists (its id and snapshot SHA-256 go on the record). */
  signedCopy: { id: string; sha: string | null } | null;
  /** The confirmation already recorded for THIS record, if any. */
  confirmation: OwnerPiesaConfirmation | null;
};

const MEL = "Australia/Melbourne";
/** "24 October 2026" from a YYYY-MM-DD or ISO value. */
export const confirmLongDate = (v: string) => new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00+10:00` : v).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric", timeZone: MEL });
/** YYYY-MM-DD in Melbourne for an ISO instant. */
export const melbourneDateOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: MEL, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** The four official owner declarations the confirmation stands for (PIESA form, "Property Owner / Owner's Representative Declaration"). */
export const OFFICIAL_OWNER_DECLARATIONS = [
  "I acknowledge that access to the ceiling space between now and the installation of insulation may void this assessment.",
  "I confirm that the electrical safety assessment works were completed on the above date.",
  "I confirm that any electrical rectification works were completed on the above date.",
  "I understand that information contained within this form will be provided to the person undertaking the installation work and may be provided upon request to Essential Services Commission (ESC) for the purposes of monitoring compliance with the Victorian Energy Efficiency Target Act 2007.",
] as const;

// ---------- the page (approved mock-up P6 wording lives in owner-pages.core P6; this is what it shows) ----------
export type PiesaConfirmPage = {
  assessmentDate: string; electricianLine: string; outcomeKind: PiesaOutcomeKind; outcome: string; warning: string;
  /** The one confirmation tick: "The assessment was completed on 24 October 2026" */
  tick: string; declarations: readonly string[];
  confirmed: { name: string; signedOn: string } | null;
};
export function piesaConfirmPage(f: PiesaOwnerConfirmFacts): PiesaConfirmPage {
  const date = confirmLongDate(f.completedDate);
  const kind = piesaOutcomeKind(f);
  const who = f.electrician.name ? `${f.electrician.name}${f.electrician.recName ? ` (${f.electrician.recName})` : ""}` : f.electrician.recName ?? "Your electrician";
  return {
    assessmentDate: date, electricianLine: who, outcomeKind: kind, outcome: OUTCOME_LABEL[kind], warning: CEILING_ENTRY_WARNING,
    tick: confirmTickText(date), declarations: OFFICIAL_OWNER_DECLARATIONS,
    confirmed: f.confirmation ? { name: f.confirmation.name, signedOn: confirmLongDate(f.confirmation.signedAt) } : null,
  };
}
export const confirmTickText = (longDate: string) => `The assessment was completed on ${longDate}`;

// ---------- validation ----------
export type PiesaConfirmInput = { fullName: string; confirmed: boolean; signatureName: string; authority: "owner" | "authorised_representative" };
export function validateOwnerPiesaConfirmation(i: PiesaConfirmInput): string[] {
  const errs: string[] = [];
  const name = i.fullName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || !/\s/.test(name)) errs.push("Type your full name (first and last).");
  if (!i.confirmed) errs.push("Tick to confirm the assessment was completed on that date.");
  if (i.signatureName.trim().replace(/\s+/g, " ").toLowerCase() !== name.toLowerCase()) errs.push("Your typed signature must match your full name.");
  if (!["owner", "authorised_representative"].includes(i.authority)) errs.push("Say whether you are the owner or signing for the owner.");
  return errs;
}

// ---------- the record ----------
export type PiesaOwnerConfirmedDetails = {
  version: typeof PIESA_OWNER_CONFIRM_VERSION; piesa_record_id: string; completed_date: string; signed_copy_id: string | null; snapshot_sha256: string | null;
  name: string; authority: "owner" | "authorised_representative"; signed_at: string;
  /** Decision 306 (Jo 25 Oct 2026): no 6-digit code — the secure link alone. Old confirmations carry the code session id; new ones null. */ link_code_id: string | null;
  ip_hash: string | null; ua_hash: string | null;
};
export function buildPiesaOwnerConfirmation(i: { facts: PiesaOwnerConfirmFacts; name: string; authority: "owner" | "authorised_representative"; signedAt: string; codeId: string | null; ipHash: string | null; uaHash: string | null }): PiesaOwnerConfirmedDetails {
  return {
    version: PIESA_OWNER_CONFIRM_VERSION, piesa_record_id: i.facts.piesaRecordId, completed_date: i.facts.completedDate,
    signed_copy_id: i.facts.signedCopy?.id ?? null, snapshot_sha256: i.facts.signedCopy?.sha ?? null,
    name: i.name.trim().replace(/\s+/g, " "), authority: i.authority, signed_at: i.signedAt, link_code_id: i.codeId, ip_hash: i.ipHash, ua_hash: i.uaHash,
  };
}
export const piesaOwnerConfirmedSummary = (d: PiesaOwnerConfirmedDetails) => `Owner confirmed the electrical safety check (PIESA of ${d.completed_date}) on their secure link: ${d.name}${d.authority === "authorised_representative" ? " (signing for the owner)" : ""}`;

/** The confirmation for THIS PIESA record from the job's `piesa_owner_confirmed` events (latest wins); another record's confirmation never counts. */
export function confirmationFromEvents(events: { details: unknown; created_at?: string }[], piesaRecordId: string | null): OwnerPiesaConfirmation | null {
  if (!piesaRecordId) return null;
  let out: OwnerPiesaConfirmation | null = null;
  for (const e of events) {
    const d = (e.details ?? null) as Partial<PiesaOwnerConfirmedDetails> | null;
    if (!d || d.piesa_record_id !== piesaRecordId || !d.name || !d.signed_at) continue;
    if (!out || d.signed_at > out.signedAt) out = { name: d.name, authority: d.authority === "authorised_representative" ? "authorised_representative" : "owner", signedAt: d.signed_at, piesaRecordId, signedCopyId: d.signed_copy_id ?? null };
  }
  return out;
}

/** What the official-form expansion needs (ExpandContext.ownerConfirmation). */
export const ownerConfirmationForForm = (c: OwnerPiesaConfirmation | null) => (c ? { name: c.name, date: melbourneDateOf(c.signedAt) } : null);

// ---------- the gate ----------
/** The reason the install cannot be booked (null = fine). No PIESA record yet = nothing to confirm (other blockers say "PIESA not completed"). */
export function ownerPiesaConfirmationBlocker(f: { piesaRecordId: string | null; confirmation: { piesaRecordId: string } | null }): string | null {
  if (!f.piesaRecordId) return null;
  return f.confirmation?.piesaRecordId === f.piesaRecordId ? null : OWNER_PIESA_CONFIRMATION_BLOCKER;
}

// ---------- reminders ----------
export type PiesaConfirmStep = "request" | "reminder_1" | "reminder_3" | "office_alert_5";
export const PIESA_CONFIRM_SCHEDULE: { step: PiesaConfirmStep; afterDays: number }[] = [
  { step: "request", afterDays: 0 }, { step: "reminder_1", afterDays: 1 }, { step: "reminder_3", afterDays: 3 }, { step: "office_alert_5", afterDays: 5 },
];
const t = (iso: string) => Date.parse(iso);
/** Next unsent step whose day has arrived (one per sweep, in order; nothing once the owner has confirmed). */
export function nextPiesaConfirmStep(x: { completedAt: string | null; confirmedAt: string | null; done: PiesaConfirmStep[]; now: string }): PiesaConfirmStep | null {
  if (!x.completedAt || x.confirmedAt) return null;
  const base = t(x.completedAt), now = t(x.now);
  if (!Number.isFinite(base)) return null;
  for (const s of PIESA_CONFIRM_SCHEDULE) {
    if (x.done.includes(s.step)) continue;
    return now >= base + s.afterDays * 86400_000 ? s.step : null;
  }
  return null;
}
/** Keys name the PIESA record: a re-done PIESA gets its own request + reminders. */
export const piesaConfirmKey = (jobId: string, piesaRecordId: string, step: PiesaConfirmStep) => `piesa-owner-confirm:v1:${jobId}:${piesaRecordId}:${step}`;
export const piesaConfirmPurpose = (step: PiesaConfirmStep) => `piesa_owner_confirm_${step}`;

// ---------- wording (DRAFT until Jo approves; the brand prefix is added by the sender) ----------
export function piesaOwnerConfirmRequestText(link: string): string {
  return `Your electrical safety check is done. Please confirm it so we can book your install (takes a minute): ${link} Reply STOP to opt out.`;
}
export function piesaOwnerConfirmReminderText(link: string): string {
  return `Your install can't be booked until you confirm your electrical safety check. It takes a minute: ${link} Reply STOP to opt out.`;
}

/** O71 email renderer: piesa-owner-confirm-email.core.ts (kept apart so client screens never bundle the email kit). */
