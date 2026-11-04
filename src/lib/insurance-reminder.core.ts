// New job flow Part 9 Task 8 (Jo 2 Nov 2026): insurance / licence expiry reminders, 30 and 7 days before a document on
// file lapses — to the installer's main business email with a copy to info@homeinsulationvictoria.com.au (answer 17).
// Electricians' licence reminders go the same way to their business email. PURE: the sweep (insurance-reminder.server)
// reads the dates and sends through the guarded senders; nothing here sends.
//
// Wording APPROVED by Jo 4 Nov 2026 14:50 as drafted. INSURANCE_REMINDER_APPROVED stays false until go-live flips it (Part 11);
// until then real businesses get nothing (held, recorded once per key).
import { TRADE_DOC_LABEL } from "./trade-expiry.core";

/** Wording approved by Jo 4 Nov 2026 14:50; the flag flips at go-live (Part 11). Until then real sends are held (recorded once per key). */
export const INSURANCE_REMINDER_APPROVED = false;
export const INSURANCE_REMINDER_DAYS = [30, 7] as const;
export type InsuranceReminderDays = (typeof INSURANCE_REMINDER_DAYS)[number];
export const OFFICE_COPY_EMAIL = "info@homeinsulationvictoria.com.au";
/** admin_config_events (job-less) event types: one claim per send, one hold per key. */
export const INSURANCE_REMINDER_EVENT = "insurance_reminder_sent";
export const INSURANCE_REMINDER_HELD_EVENT = "insurance_reminder_held";
/** Documents reminded about (business documents by kind; a person's electrical licence as `worker_licence`). */
// Jo 4 Nov 2026 21:08 (G8): workers comp is not collected — no reminder for it.
export const INSURANCE_REMINDER_KINDS = ["public_liability_insurance", "electrical_licence", "worker_licence"] as const;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

/**
 * Which reminder is due today for a document expiring on `expiresOn` (YYYY-MM-DD): 30 when 30 days or fewer remain and
 * the 30-day one hasn't gone, 7 when 7 days or fewer remain and the 7-day one hasn't gone; null otherwise (expired, far
 * off, or both done). Each step goes once; a late tick still sends the step that is due (never a missed earlier step).
 */
export function dueInsuranceReminder(expiresOn: string, today: string, done: readonly number[]): InsuranceReminderDays | null {
  const left = daysBetween(today, expiresOn);
  if (!Number.isFinite(left) || left < 0) return null;
  if (left <= 7) return done.includes(7) ? null : 7;
  if (left <= 30) return done.includes(30) ? null : 30;
  return null;
}

/** One key per business + document + expiry date + step; the office copy adds `:office`. */
export const insuranceReminderKey = (businessId: string, kind: string, expiresOn: string, days: number, personId: string | null = null) =>
  `insurance-reminder:v1:${businessId}:${kind}${personId ? `:${personId}` : ""}:${expiresOn.slice(0, 10)}:${days}`;

const longDate = (ymd: string) => new Date(`${ymd.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replace(",", "");

/** DRAFT (plan Task 8): subject `Your {document} expires on {date}`; one plain paragraph. `person` names whose licence it is. */
export function renderInsuranceReminder(i: { kind: string; expiresOn: string; businessName: string; person?: string | null; test?: boolean }): { subject: string; text: string; html: string } {
  const doc = (TRADE_DOC_LABEL[i.kind] ?? i.kind.replace(/_/g, " ")).toLowerCase();
  const date = longDate(i.expiresOn);
  const whose = i.person ? `${i.person}'s ${doc}` : `your ${doc}`;
  const subject = `${i.test ? "[TEST] " : ""}${i.person ? `${i.person}'s ${doc}` : `Your ${doc}`} expires on ${date}`;
  const body = `Upload the new one on My business before ${date}. Until Home Insulation Victoria has checked it, you can't take new jobs, bookings or installs.`;
  const text = `Hi ${i.businessName},\n\n${whose.charAt(0).toUpperCase()}${whose.slice(1)} expires on ${date}.\n\n${body}\n\nHome Insulation Victoria`;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<p>Hi ${esc(i.businessName)},</p><p>${esc(whose.charAt(0).toUpperCase() + whose.slice(1))} expires on ${esc(date)}.</p><p>${esc(body)}</p><p>Home Insulation Victoria</p>`;
  return { subject, text, html };
}
