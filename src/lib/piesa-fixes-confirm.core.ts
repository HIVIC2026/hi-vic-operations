// Decision 330 (Jo, 25 Oct 2026): when the A5 electrical fixes form is Complete (fixes-day.server completeFixesForm → the
// post_rectification PIESA record), the owner is asked ONCE (email O72 + text) to confirm on the same secure My job page
// (decision 296's P6 card, decision 306: no code) that the electrical fixes were done: one tick "The electrical fixes were
// completed on {date}" + typed full name. Reminders on days 1 and 3, office row only if still unconfirmed 5 days after (as O71).
// That confirmation fills the official PIESA owner declaration "I confirm that any electrical rectification works were
// completed on the above date" (official-expand ctx.ownerFixesConfirmation; o.date = the date the owner confirmed).
// Install booking is NOT held for it (the decision-296 initial confirmation gate is unchanged).
// PURE: page, validation, record shape, schedule, wording. No I/O.
import { confirmLongDate, melbourneDateOf, type PiesaConfirmStep } from "./piesa-owner-confirm.core";

export const PIESA_FIXES_CONFIRM_VERSION = "piesa-fixes-confirm-v1";
/** Append-only workflow event: one per owner confirmation of one post_rectification PIESA record. */
export const PIESA_FIXES_CONFIRMED_EVENT = "piesa_owner_fixes_confirmed";
/** One per step (recorded BEFORE anything is sent; keyed to the post_rectification record). */
export const PIESA_FIXES_CONFIRM_STEP_EVENT = "piesa_owner_fixes_confirm_reminder";
/** Day-5 office alert (Needs me row `piesa_fixes_owner_unsigned`). */
export const PIESA_FIXES_CONFIRM_OFFICE_ALERT_EVENT = "piesa_owner_fixes_unconfirmed_5_days";
export const PIESA_FIXES_CONFIRM_SMS_TYPE = "piesa_owner_fixes_confirm" as const;
/** Decision 330: wording approved by Jo (email + text). Delivery still behind customer_comms_enabled + consent. */
export const PIESA_FIXES_CONFIRM_EMAIL_APPROVED = true as boolean;
export const O72_TEMPLATE_CODE = "O72";
/** Flag the official-form expansion raises when repairs were needed and the owner has not confirmed them after the fixes. */
export const OWNER_FIXES_NOT_CONFIRMED_FLAG = "Owner hasn't confirmed the electrical fixes";
/** The official owner declaration this confirmation stands for. */
export const OFFICIAL_FIXES_DECLARATION = "I confirm that any electrical rectification works were completed on the above date.";

export type OwnerFixesConfirmation = { name: string; authority: "owner" | "authorised_representative"; signedAt: string; recordId: string };
export type PiesaFixesConfirmFacts = {
  /** The latest `post_rectification` piesa_records row (the A5 fixes record). */
  recordId: string;
  /** Date the fixes were certified (YYYY-MM-DD) and when the record was written (ISO) — the reminder clock starts here. */
  fixesDate: string; completedAt: string;
  electrician: { name: string | null; recName: string | null };
  confirmation: OwnerFixesConfirmation | null;
};

export const fixesTickText = (longDate: string) => `The electrical fixes were completed on ${longDate}`;
export type PiesaFixesConfirmPage = { fixesDate: string; electricianLine: string; tick: string; declaration: string; confirmed: { name: string; signedOn: string } | null };
export function piesaFixesConfirmPage(f: PiesaFixesConfirmFacts): PiesaFixesConfirmPage {
  const date = confirmLongDate(f.fixesDate);
  const who = f.electrician.name ? `${f.electrician.name}${f.electrician.recName ? ` (${f.electrician.recName})` : ""}` : f.electrician.recName ?? "Your electrician";
  return { fixesDate: date, electricianLine: who, tick: fixesTickText(date), declaration: OFFICIAL_FIXES_DECLARATION, confirmed: f.confirmation ? { name: f.confirmation.name, signedOn: confirmLongDate(f.confirmation.signedAt) } : null };
}

export type PiesaFixesConfirmInput = { fullName: string; confirmed: boolean; signatureName: string; authority: "owner" | "authorised_representative" };
export function validateOwnerFixesConfirmation(i: PiesaFixesConfirmInput): string[] {
  const errs: string[] = [];
  const name = i.fullName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || !/\s/.test(name)) errs.push("Type your full name (first and last).");
  if (!i.confirmed) errs.push("Tick to confirm the electrical fixes were completed on that date.");
  if (i.signatureName.trim().replace(/\s+/g, " ").toLowerCase() !== name.toLowerCase()) errs.push("Your typed signature must match your full name.");
  if (!["owner", "authorised_representative"].includes(i.authority)) errs.push("Say whether you are the owner or signing for the owner.");
  return errs;
}

export type PiesaFixesConfirmedDetails = {
  version: typeof PIESA_FIXES_CONFIRM_VERSION; piesa_record_id: string; fixes_date: string;
  name: string; authority: "owner" | "authorised_representative"; signed_at: string; ip_hash: string | null; ua_hash: string | null;
};
export function buildPiesaFixesConfirmation(i: { facts: PiesaFixesConfirmFacts; name: string; authority: "owner" | "authorised_representative"; signedAt: string; ipHash: string | null; uaHash: string | null }): PiesaFixesConfirmedDetails {
  return { version: PIESA_FIXES_CONFIRM_VERSION, piesa_record_id: i.facts.recordId, fixes_date: i.facts.fixesDate, name: i.name.trim().replace(/\s+/g, " "), authority: i.authority, signed_at: i.signedAt, ip_hash: i.ipHash, ua_hash: i.uaHash };
}
export const piesaFixesConfirmedSummary = (d: PiesaFixesConfirmedDetails) => `Owner confirmed the electrical fixes (certified ${d.fixes_date}) on their secure link: ${d.name}${d.authority === "authorised_representative" ? " (signing for the owner)" : ""}`;

/** The confirmation for THIS post_rectification record (latest wins); another record's confirmation never counts. */
export function fixesConfirmationFromEvents(events: { details: unknown }[], recordId: string | null): OwnerFixesConfirmation | null {
  if (!recordId) return null;
  let out: OwnerFixesConfirmation | null = null;
  for (const e of events) {
    const d = (e.details ?? null) as Partial<PiesaFixesConfirmedDetails> | null;
    if (!d || d.piesa_record_id !== recordId || !d.name || !d.signed_at) continue;
    if (!out || d.signed_at > out.signedAt) out = { name: d.name, authority: d.authority === "authorised_representative" ? "authorised_representative" : "owner", signedAt: d.signed_at, recordId };
  }
  return out;
}
/** ExpandContext.ownerFixesConfirmation. */
export const ownerFixesConfirmationForForm = (c: OwnerFixesConfirmation | null) => (c ? { name: c.name, date: melbourneDateOf(c.signedAt) } : null);

/** Same days as O71 (request, day 1, day 3, office day 5); keys name the post_rectification record. */
export const piesaFixesConfirmKey = (jobId: string, recordId: string, step: PiesaConfirmStep) => `piesa-owner-fixes-confirm:v1:${jobId}:${recordId}:${step}`;
export const piesaFixesConfirmPurpose = (step: PiesaConfirmStep) => `piesa_owner_fixes_confirm_${step}`;

// ---------- wording (approved by Jo, decision 330; the brand prefix is added by the sender) ----------
export const piesaFixesConfirmText = (link: string) => `Your electrical fixes are done. Please confirm (takes a minute): ${link} Reply STOP to opt out.`;
export const piesaFixesConfirmSubject = (first: string) => `${first}, your electrical fixes are done — please confirm`;
export const piesaFixesConfirmBody = (electrician: string, longDate: string) => `${electrician} finished the electrical fixes at your home on ${longDate}. Please confirm on your job page. It takes a minute.`;
