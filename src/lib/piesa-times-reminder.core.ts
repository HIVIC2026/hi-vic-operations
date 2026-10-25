// Decision 376 (Jo 25 Oct 2026, DRAFT — awaiting approval): the 24-hour coordination point (allocation.server
// `sweepCoordination`, `coordination_reminder`) is the moment a trade was given the owner's contact details for a visit and
// has proposed no time 24 hours later. In today's flows only ONE case is still a real gap the trade must act on: the
// electrician accepted a safety check (PIESA) job and has not offered the owner 3 times (decision 333 — "offer the owner 3
// times within 24 hours", D93 text). The ELECTRICIAN gets ONE reminder: email E14 + text. Not the owner (the owner is
// waiting on the electrician, not the other way round). The other visit kinds stay record-only, because an approved
// message already covers them or the point cannot arise:
//  - Ready Check: our-lead installers accept BY offering times (no gap), and the offer closes at 24h and returns to the
//    office (ready-check-times.server); installer-supplied jobs arrange their own visit directly (decision 180).
//  - Installation: contacts are released only when the day is booked (install-days.server bookAgreedDay), so there is
//    never a "released, nothing proposed" gap; the installer was already told by the approved I65 email + text (186).
//  - Electrical fixes: the electrician was already texted the approved fixes-times link (decision 315), and their fixes
//    windows are normally given before the contacts are shared.
// The 48-hour office alert (needs `piesa_booking_overdue`) is unchanged. PURE: wording, keys, which kinds send.
import * as K from "./email-kit.core";

/** DRAFT (decision 376): false until Jo approves E14 and the text. Real delivery also needs customer_comms_enabled. */
export const PIESA_TIMES_REMINDER_APPROVED = false as boolean;
export const PIESA_TIMES_REMINDER_TEMPLATE_CODE = "E14";
export const PIESA_TIMES_REMINDER_SMS_TYPE = "piesa_times_reminder" as const;

/** contact_releases.visit_kind values that get a trade reminder at 24h (everything else stays record-only). */
export const REMINDED_VISIT_KINDS: ReadonlySet<string> = new Set(["piesa"]);
export const coordinationReminderSends = (visitKind: string) => REMINDED_VISIT_KINDS.has(visitKind);

/** One email + one text per electrician assignment, ever. */
export function piesaTimesReminderKeys(assignmentId: string) {
  const base = `piesa-times-reminder:v1:${assignmentId}`;
  return { email: `${base}:email`, sms: `${base}:sms` };
}

export type PiesaTimesReminderFacts = { jobNumber: string; address: string | null; link: string };

/** Text (the sender adds "Home Insulation Victoria: "). One-off partner job text: no STOP line, same as `piesa_offer`. */
export function piesaTimesReminderText(f: PiesaTimesReminderFacts): string {
  return `Reminder: ${f.jobNumber}${f.address ? ` at ${f.address}` : ""} still needs safety check times. Please offer the owner 3 times on your job page: ${f.link}`;
}

export function renderPiesaTimesReminderEmail(i: PiesaTimesReminderFacts & { firstName: string | null; test?: boolean }) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = `${i.jobNumber}: please offer the owner 3 safety check times`;
  const headline = "Please offer the owner 3 safety check times";
  const lead = `Hi ${first}, you took the safety check job ${i.jobNumber}${i.address ? ` at ${i.address}` : ""} a day ago, but no times have been offered to the owner yet.`;
  const ask = "Please offer 3 times on 3 different days from your job page. The owner picks one and it's booked — it only takes a minute.";
  const cant = "Can't do this job any more? Just reply to this email and we'll sort it out.";
  const body = [K.h1(headline, 8), K.p(lead), K.p(ask), K.button(i.link, "Offer 3 times"), K.small(cant)].join("\n");
  const html = K.emailShell({ body, previewText: lead, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([headline, "", lead, "", ask, "", `Offer 3 times: ${i.link}`, "", cant], { testLabel: i.test === true });
  return { subject, html, text };
}
