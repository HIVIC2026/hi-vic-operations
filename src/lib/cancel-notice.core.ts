// Decision 291 (Jo, 25 Oct 2026): cancelling a job with "tell the owner" / "tell the installer" ticked SENDS the owner
// email O69 "Job cancelled" and the installer email I70 "Job cancelled" (both EMAIL, no text) — wording approved
// verbatim; designs docs/templates/mjml/owner_O69.mjml and installer_I70.mjml. Pure: wording, keys and
// event names only. Delivery lives in cancel-notice.server.ts (TEST → test-send; real owner → sendGuardedOwnerEmail
// behind customer_comms_enabled + consent/opt-out; real installer → the partner office-email path). No prices anywhere.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";

/** Jo 25 Oct 2026 (decision 291): O69 + I70 wording approved. */
export const CANCEL_NOTICE_EMAILS_APPROVED = true as boolean;
/** Recorded once per send (details: { who, channel, cancel_seq, status, to }). */
export const CANCEL_NOTICE_SENT_EVENT = "cancel_notice_sent" as const;
/** Recorded instead when a ticked notice could not go (comms off, no address, no consent, wording off, provider refusal). */
export const CANCEL_NOTICE_HELD_EVENT = "cancel_notice_held" as const;
/** customer_email_sends purposes (send-failed.core labels them for Needs me). */
export const CANCEL_NOTICE_PURPOSE = { owner: "job_cancelled", installer: "job_cancelled_installer" } as const;

export type CancelNoticeWho = keyof typeof CANCEL_NOTICE_PURPOSE;

/** One key per job + cancellation (cancelSeq = how many earlier cancellations the job had) + recipient. A reopened job
 *  cancelled again is a new cancellation; a retry of the same one is refused by the ledger's unique key. */
export const cancelNoticeKey = (jobId: string, cancelSeq: number, who: CancelNoticeWho) => `cancel-notice:v1:${jobId}:${cancelSeq}:${who}`;

/** "{street}, {suburb}" for the installer line/subject (never the owner's name or price). */
export function cancelNoticePlace(i: { addressLine: string | null; suburb: string | null }): string | null {
  const street = i.addressLine?.trim().replace(/,\s*$/, "") || null;
  const suburb = i.suburb?.trim() || null;
  const s = street && suburb && street.toLowerCase().endsWith(suburb.toLowerCase()) ? street.slice(0, street.length - suburb.length).replace(/[,\s]+$/, "") : street;
  return [s, suburb].filter(Boolean).join(", ") || null;
}

export type OwnerCancelledEmailInput = {
  firstName: string | null;
  jobNumber: string;
  /** Full address, e.g. "824 High Street Road, Glen Waverley VIC 3150". */
  address: string | null;
  /** The office phone (env HIV_OFFICE_PHONE). Null = no number on file: the line keeps "reply to this email" only. */
  officePhone: string | null;
  test?: boolean;
};

/** O69 — Subject "Your ceiling insulation job {HV} has been cancelled". Body is Jo's wording verbatim. */
export function renderOwnerCancelledEmail(i: OwnerCancelledEmailInput): { subject: string; html: string; text: string } {
  const first = K.cleanName(i.firstName) ?? "there";
  const where = i.address?.trim() || "your property";
  const phone = i.officePhone?.trim() || null;
  const subject = `Your ceiling insulation job ${i.jobNumber} has been cancelled`;
  const p1 = `We've cancelled your ceiling insulation job at ${where}, as discussed. Nothing further will happen on it and you won't hear from us again about it unless you get back in touch.`;
  // Jo 26 Oct: no HIV phone number and no "call us" in owner emails.
  const p2 = "If this was a mistake or you'd like to pick it up again later, reply to this email.";
  const preview = "Nothing further will happen on it. If this was a mistake, just reply.";
  const body = `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">Job cancelled</mj-text><mj-text padding="0 12px 10px">${esc(`Hi ${first},`)}</mj-text><mj-text>${esc(p1)}</mj-text><mj-text>${esc(p2)}</mj-text><mj-text padding="0 12px 0">Home Insulation Victoria</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([`Hi ${first},`, "", p1, "", p2, "", "Home Insulation Victoria"], { testLabel: i.test === true });
  return { subject, html, text };
}

export type InstallerCancelledEmailInput = {
  jobNumber: string;
  /** "{street}, {suburb}" from cancelNoticePlace. */
  place: string | null;
  officePhone: string | null;
  test?: boolean;
};

/** I70 — Subject "{HV} cancelled – {street, suburb}". Body is Jo's wording verbatim. No owner name, no price. */
export function renderInstallerCancelledEmail(i: InstallerCancelledEmailInput): { subject: string; html: string; text: string } {
  const where = i.place?.trim() || "the property";
  const phone = i.officePhone?.trim() || null;
  const subject = `${i.jobNumber} cancelled – ${where}`;
  // MJML refresh fix (docs/templates/mjml/notes/installer_I70.json): no "HIV:" text-message prefix; the brand is in the header.
  const line = `${i.jobNumber} at ${where} has been cancelled. Nothing more to do on it — it's gone from your list.`;
  const questions = phone ? `Questions: ${phone}.` : "Questions: reply to this email.";
  const preview = "Nothing more to do on it. It's gone from your list.";
  const body = `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(`${i.jobNumber} cancelled`)}</mj-text><mj-text>${esc(line)}</mj-text><mj-text mj-class="small">${esc(questions)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([line, "", questions], { testLabel: i.test === true });
  return { subject, html, text };
}
