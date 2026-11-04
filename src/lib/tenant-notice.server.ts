// Part 4 Task 16 (cl 23; Jo 2 Nov 2026, answers 7 and 22): once the install day is booked — and whenever its time changes —
// the TENANT is told by text AND email (always both): the date, the time, that the power will be off for the day, and the
// business name + office phone. Called from notifyOwnerBooked (in-house-booking.server) for install bookings, BEFORE the
// owner's own sends, so the owner's email outcome never decides whether the tenant hears.
// - Off while TENANT_NOTICE_APPROVED is false (DRAFT wording): "awaiting approval", nothing read or sent; the SMS type is
//   also `wordingApproved: false` with its own switch, so nothing can go early.
// - Rented (rentalAnswersFor, Part 3 Task 19) → the tenant's OR the property manager's name/mobile/email (whoever the owner
//   picked on the quick taps, Jo 4 Nov 2026 21:40: `noticePersonOf`). Rented but details
//   missing (taps taken before Task 19 shipped, or an own customer who hasn't answered yet) → "held: no tenant details" +
//   ONE `tenant_notice_held` note per booking + reason → Needs me `tenant_notice_held` until a notice for that booking goes.
// - Compliance send: purpose `tenant_notice` is in COMPLIANCE_OWNER_EMAIL_PURPOSES (the owner's Do not contact / unsubscribe
//   never hold it — nothing about Do not contact is read here); the comms master switch still applies; a STOP from the
//   tenant's own number holds the text (the email still goes). Keys tenant-notice:v1:{booking}:sms|email; a changed time is
//   a new booking row, so a new notice. Quiet hours are checked before anything is recorded (the booked sweep retries).
// - TEST jobs → test-send (both channels); real → sendRealSms + sendGuardedOwnerEmail.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { smsQuietReason } from "./quote-hold.core";
import { QUIET_HOURS_WAIT } from "./approved-texts.core";
import { noticePersonOf, type RentalAnswers } from "./rental-answers.core";
import type { TradeContact } from "./owner-will-call.core";
import { toAuE164 } from "./sms.core";
import type { RealSmsInput, RealSmsResult } from "./sms.server";
import {
  NO_TENANT_DETAILS, NO_TENANT_EMAIL, TENANT_NOTICE_APPROVED, TENANT_NOTICE_EMAIL_PURPOSE, TENANT_NOTICE_HELD_EVENT, TENANT_NOTICE_SENT_EVENT, TENANT_NOTICE_SMS_TYPE, tenantNotice,
  tenantNoticeHeldLine, tenantNoticeKey, tenantNoticeNeeded,
} from "./tenant-notice.core";

type JobRow = { id: string; source: string | null; stage: string; deleted_at: string | null; owners: { full_name: string | null; phone: string | null; email: string | null } | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null };
type BookingRow = { id: string; job_id: string; kind: string; status: string; scheduled_start: string; created_at: string };
type Mail = { subject: string; html: string; text: string };
export type TenantNoticeDeps = {
  approved: boolean;
  readJob: (jobId: string) => Promise<JobRow | null>;
  readBooking: (bookingId: string, jobId: string) => Promise<BookingRow | null>;
  rentalAnswers: (jobId: string) => Promise<RentalAnswers | null>;
  /** The installer business coming (office phone, never a worker's). */
  businessContact: (jobId: string) => Promise<TradeContact | null>;
  quiet: (now: Date) => boolean;
  /** The comms master switch + the owner consent read the compliance way (assertCustomerDeliveryAllowed with the purpose). */
  allowed: (jobId: string) => Promise<void>;
  /** Append-only note; `details.id` is deterministic so a repeat adds nothing (23505 ignored). */
  recordEvent: (jobId: string, type: string, details: Record<string, unknown> & { id: string }) => Promise<void>;
  sendSms: (input: RealSmsInput) => Promise<RealSmsResult>;
  sendEmail: (p: { jobId: string; jobSource: string | null; to: string; purpose: string; key: string; build: (unsubscribeUrl: string | null) => Mail }) => Promise<string>;
  sendTestSms: (to: string, body: string, job: JobRow, label: string) => Promise<{ status: string; detail: string }>;
  sendTestEmail: (to: string, mail: Mail, job: JobRow) => Promise<{ status: string; detail: string }>;
};

const defaults = (): TenantNoticeDeps => ({
  approved: TENANT_NOTICE_APPROVED,
  readJob: async (jobId) => {
    const { data, error } = await admin.from("jobs").select("id, source, stage, deleted_at, owners(full_name, phone, email), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
    if (error) throw new Error(`Could not read the job: ${error.message}`);
    return (data as unknown as JobRow | null) ?? null;
  },
  readBooking: async (bookingId, jobId) => {
    const { data, error } = await admin.from("bookings").select("id, job_id, kind, status, scheduled_start, created_at").eq("id", bookingId).eq("job_id", jobId).maybeSingle();
    if (error) throw new Error(`Could not read the booking: ${error.message}`);
    return (data as BookingRow | null) ?? null;
  },
  rentalAnswers: async (jobId) => (await import("./rental-answers.server")).rentalAnswersFor(jobId),
  businessContact: async (jobId) => (await import("./owner-contact.server")).businessContactForJob(jobId, "installer"),
  quiet: (now) => !!smsQuietReason(now.toISOString()),
  allowed: async (jobId) => (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Tenant notice (cl 23)", TENANT_NOTICE_EMAIL_PURPOSE),
  recordEvent: async (jobId, type, { id, ...details }) => {
    const summary = type === TENANT_NOTICE_HELD_EVENT ? tenantNoticeHeldLine(String(details["reason"] ?? "held")) : "Tenant told the install day, time and power-off (cl 23)";
    const { error } = await admin.from("workflow_events").insert({ id, job_id: jobId, actor_id: null, event_type: type, summary, details: details as Record<string, string | null>, internal: true });
    if (error && error.code !== "23505") throw new Error(error.message);
  },
  sendSms: async (input) => (await import("./sms.server")).sendRealSms(input),
  sendEmail: async (p) => (await import("./owner-email-send.server")).sendGuardedOwnerEmail(p),
  sendTestSms: async (to, body, job, label) => {
    const { sendTestSms } = await import("./test-send.server");
    return sendTestSms({ jobId: job.id, jobSource: job.source, partnerIsTest: await installerIsTest(job.id), label, actorId: null }, to, body);
  },
  sendTestEmail: async (to, mail, job) => {
    const { sendTestEmail } = await import("./test-send.server");
    return sendTestEmail({ jobId: job.id, jobSource: job.source, partnerIsTest: await installerIsTest(job.id), label: `${TENANT_NOTICE_SMS_TYPE}:email`, actorId: null }, to, mail.subject, mail.html, mail.text);
  },
});

async function installerIsTest(jobId: string): Promise<boolean> {
  const { isTestPartner } = await import("./test-send.core");
  const { data } = await admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  return isTestPartner((data?.businesses ?? null) as { onboarding_notes?: string | null } | null);
}

const firstName = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || null;
const addressOf = (p: JobRow["properties"]) => [p?.address_line, [p?.suburb, p?.postcode].filter(Boolean).join(" ")].map((x) => (x ?? "").trim()).filter(Boolean).join(", ");
const eventId = async (seed: string) => (await import("./mitti-create-claim.core")).stableUuid(seed);

/** Tell the tenant the install day. Returns what happened; never throws for a normal hold. */
export async function sendTenantNotice(jobId: string, bookingId: string, now = new Date(), over: Partial<TenantNoticeDeps> = {}): Promise<string> {
  const d = { ...defaults(), ...over };
  if (!d.approved) return "awaiting approval";
  const booking = await d.readBooking(bookingId, jobId);
  if (!booking || booking.kind !== "installation" || booking.status !== "confirmed" || !(Date.parse(booking.scheduled_start) > now.getTime())) return "not current";
  const job = await d.readJob(jobId);
  if (!job || job.deleted_at || job.stage === "cancelled") return "not applicable";
  const rental = await d.rentalAnswers(jobId);
  if (!tenantNoticeNeeded(rental)) return "not rented";
  const hold = async (reason: string) => {
    await d.recordEvent(jobId, TENANT_NOTICE_HELD_EVENT, { id: await eventId(`${TENANT_NOTICE_HELD_EVENT}:${jobId}:${booking.id}:${reason}`), booking_id: booking.id, starts_at: booking.scheduled_start, reason });
    return `held: ${reason}`;
  };
  // Jo 4 Nov 2026 21:40: the notice goes to the person the owner picked on the quick taps — the tenant or the property manager.
  const tenant = noticePersonOf(rental);
  const mobile = toAuE164(tenant?.mobile);
  const email = (tenant?.email ?? "").trim().toLowerCase();
  // Jo 4 Nov 2026 (pack 2 batch 7): the tenant's email is optional — no email → the text alone goes, the email is noted as held.
  if (!tenant || !mobile) return hold(NO_TENANT_DETAILS);
  const business = await d.businessContact(jobId);
  if (!business) return "missing facts";
  const test = job.source === "qa_test";
  const message = tenantNotice({ firstName: firstName(tenant.name), address: addressOf(job.properties), startIso: booking.scheduled_start, business }, { test });
  if ("held" in message) return hold(message.held);
  if (d.quiet(now)) return QUIET_HOURS_WAIT;
  try { await d.allowed(jobId); } catch { return "messages held"; }
  let smsOutcome: string, emailOutcome: string;
  if (test) {
    const s = await d.sendTestSms(mobile, message.sms, job, `${TENANT_NOTICE_SMS_TYPE}:${tenantNoticeKey(booking.id, "sms")}`);
    smsOutcome = s.status === "sent" ? "sent" : `held (${s.detail})`;
    const e = email ? await d.sendTestEmail(email, message.email, job) : { status: "held", detail: NO_TENANT_EMAIL };
    emailOutcome = e.status === "sent" ? "sent" : `held (${e.detail})`;
  } else {
    const s = await d.sendSms({ type: TENANT_NOTICE_SMS_TYPE, idempotencyKey: tenantNoticeKey(booking.id, "sms"), to: mobile, body: message.sms, jobId, event: { at: booking.created_at, current: true } });
    smsOutcome = s.status === "sent" || s.status === "sent_unknown" ? "sent" : s.status === "already" ? "already" : `held (${s.detail})`;
    const e = email ? await d.sendEmail({ jobId, jobSource: job.source, to: email, purpose: TENANT_NOTICE_EMAIL_PURPOSE, key: tenantNoticeKey(booking.id, "email"), build: () => message.email }) : `held: ${NO_TENANT_EMAIL}`;
    emailOutcome = e === "sent" ? "sent" : e.startsWith("already") ? "already" : `held (${e})`;
  }
  if (smsOutcome === "already" && (emailOutcome === "already" || !email)) return "already handled";
  if (smsOutcome === "sent" || emailOutcome === "sent") {
    await d.recordEvent(jobId, TENANT_NOTICE_SENT_EVENT, { id: await eventId(`${TENANT_NOTICE_SENT_EVENT}:${jobId}:${booking.id}`), booking_id: booking.id, starts_at: booking.scheduled_start, to_mobile: mobile, to_email: email || null, sms: smsOutcome, email: emailOutcome });
  }
  return `sent: sms ${smsOutcome}, email ${emailOutcome}`;
}
