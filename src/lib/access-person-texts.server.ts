// Part 4 Task 15 (Jo 2 Nov 2026, answer 7): the tenant / property manager who lets the trades in gets the PIESA and
// install "You're booked" text (called by notifyOwnerBooked right after the owner's notice) and the day-before text
// (called by sweepApprovedTexts for every confirmed safety check / install booking). Visit-time texts ONLY: the owner's
// quote, price, consent, payment, rebate and compliance messages never come here, and the owner still gets every message.
// - Off while ACCESS_PERSON_TEXTS_APPROVED is false (DRAFT wording): "awaiting approval", nothing read or sent; the two SMS
//   types are also `wordingApproved: false` with their own switches, so nothing can go early.
// - Who: `accessPersonFor` (Part 3 Task 19; null while RENTAL_TAPS_APPROVED is false or the home is owner-occupied) and only
//   when their mobile is not the owner's (accessPersonNeedsTexts). Ready Check bookings never qualify.
// - One text per person per visit (keys access-booked / access-tomorrow + booking id + mobile); a changed time is a new
//   booking row, so a new key. Quiet hours are checked before anything is recorded (the in-house booked sweep and the
//   15-minute tick retry). No office phone → ONE office note per booking + reason, nothing sent (like the owner's text).
// - TEST jobs → test-send; real → the ONE real sender (`sendRealSms`: comms switch + type switch + the job's owner consent +
//   STOP list for THEIR number + idempotency key). The owner's "Do not contact" is about the owner and is not read here.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import {
  ACCESS_PERSON_BOOKED_SMS_TYPE, ACCESS_PERSON_TEXTS_APPROVED, ACCESS_PERSON_TOMORROW_SMS_TYPE, ACCESS_TEXT_HELD_EVENT, accessPersonBookedText, accessPersonKey,
  accessPersonNeedsTexts, accessPersonTomorrowText, type AccessVisitKind,
} from "./access-person-texts.core";
import { QUIET_HOURS_WAIT, visitTomorrowDue } from "./approved-texts.core";
import type { AccessPerson } from "./rental-answers.core";
import type { TradeContact } from "./owner-will-call.core";
import { smsQuietReason } from "./quote-hold.core";
import { toAuE164 } from "./sms.core";
import type { RealSmsInput, RealSmsResult } from "./sms.server";

type JobRow = { id: string; source: string | null; stage: string; deleted_at: string | null; owners: { full_name: string | null; phone: string | null } | null };
type BookingRow = { id: string; job_id: string; kind: string; status: string; scheduled_start: string; created_at: string };
export type AccessPersonTextDeps = {
  approved: boolean;
  readJob: (jobId: string) => Promise<JobRow | null>;
  readBooking: (bookingId: string, jobId: string) => Promise<BookingRow | null>;
  accessPerson: (jobId: string) => Promise<AccessPerson | null>;
  /** The business coming: the electrician for the PIESA, the installer for the install (office phone, never a worker's). */
  businessContact: (jobId: string, role: "installer" | "electrician") => Promise<TradeContact | null>;
  /** The person coming (name only), as recorded for the owner's "You're booked" notice. */
  whoName: (jobId: string, bookingId: string) => Promise<string | null>;
  quiet: (now: Date) => boolean;
  recordHeld: (jobId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
  sendSms: (input: RealSmsInput) => Promise<RealSmsResult>;
  sendTestSms: (to: string, body: string, job: JobRow, label: string, role: "installer" | "electrician") => Promise<{ status: string; detail: string }>;
};

const VISIT_KIND: Record<string, AccessVisitKind> = { assessment: "piesa", installation: "install" };
const ROLE: Record<AccessVisitKind, "installer" | "electrician"> = { piesa: "electrician", install: "installer" };

const defaults = (): AccessPersonTextDeps => ({
  approved: ACCESS_PERSON_TEXTS_APPROVED,
  readJob: async (jobId) => {
    const { data, error } = await admin.from("jobs").select("id, source, stage, deleted_at, owners(full_name, phone)").eq("id", jobId).maybeSingle();
    if (error) throw new Error(`Could not read the job: ${error.message}`);
    return (data as unknown as JobRow | null) ?? null;
  },
  readBooking: async (bookingId, jobId) => {
    const { data, error } = await admin.from("bookings").select("id, job_id, kind, status, scheduled_start, created_at").eq("id", bookingId).eq("job_id", jobId).maybeSingle();
    if (error) throw new Error(`Could not read the booking: ${error.message}`);
    return (data as BookingRow | null) ?? null;
  },
  accessPerson: async (jobId) => (await import("./rental-answers.server")).accessPersonFor(jobId),
  businessContact: async (jobId, role) => (await import("./owner-contact.server")).businessContactForJob(jobId, role),
  whoName: async (jobId, bookingId) => {
    const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "in_house_booked_notice_pending").contains("details", { booking_id: bookingId }).limit(1).maybeSingle();
    if (error) throw new Error(`Could not read who is coming: ${error.message}`);
    const who = (data?.details as { who?: { name?: string | null } | null } | null)?.who ?? null;
    return who?.name?.trim() || null;
  },
  quiet: (now) => !!smsQuietReason(now.toISOString()),
  recordHeld: async (jobId, reason, details) => {
    const { stableUuid } = await import("./mitti-create-claim.core");
    const id = await stableUuid(`${ACCESS_TEXT_HELD_EVENT}:${jobId}:${details["booking_id"]}:${details["text"]}:${reason}`);
    const { error } = await admin.from("workflow_events").insert({ id, job_id: jobId, actor_id: null, event_type: ACCESS_TEXT_HELD_EVENT, summary: `Text to the person who lets the trades in not sent — ${reason}. Add it on the business, then it goes automatically.`, details: { ...details, reason }, internal: true });
    if (error && error.code !== "23505") throw new Error(error.message);
  },
  sendSms: async (input) => (await import("./sms.server")).sendRealSms(input),
  sendTestSms: async (to, body, job, label, role) => {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestSms } = await import("./test-send.server");
    const { data } = await admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", job.id).eq("role", role).eq("active", true).limit(1).maybeSingle();
    return sendTestSms({ jobId: job.id, jobSource: job.source, partnerIsTest: isTestPartner((data?.businesses ?? null) as { onboarding_notes?: string | null } | null), label, actorId: null }, to, body);
  },
});

type Prepared = { job: JobRow; booking: BookingRow; kind: AccessVisitKind; access: AccessPerson; e164: string; business: TradeContact } | string;
/** Everything both texts need, or why there is nothing to send. */
async function prepare(jobId: string, bookingId: string, now: Date, d: AccessPersonTextDeps): Promise<Prepared> {
  const booking = await d.readBooking(bookingId, jobId);
  if (!booking) return "not current";
  const kind = VISIT_KIND[booking.kind];
  if (!kind) return "not applicable";
  if (booking.status !== "confirmed" || !(Date.parse(booking.scheduled_start) > now.getTime())) return "not current";
  const job = await d.readJob(jobId);
  if (!job || job.deleted_at || job.stage === "cancelled") return "not applicable";
  const access = await d.accessPerson(jobId);
  if (!accessPersonNeedsTexts(access, job.owners?.phone ?? null)) return "no access person";
  const e164 = toAuE164(access!.mobile)!;
  const business = await d.businessContact(jobId, ROLE[kind]);
  if (!business) return "missing facts";
  return { job, booking, kind, access: access!, e164, business };
}

async function deliver(p: Exclude<Prepared, string>, text: typeof ACCESS_PERSON_BOOKED_SMS_TYPE | typeof ACCESS_PERSON_TOMORROW_SMS_TYPE, body: string | { held: string }, key: string, d: AccessPersonTextDeps, event?: RealSmsInput["event"]): Promise<string> {
  if (typeof body !== "string") {
    await d.recordHeld(p.job.id, body.held, { booking_id: p.booking.id, starts_at: p.booking.scheduled_start, visit: p.kind, text, who: p.access.who });
    return `held — ${body.held}`;
  }
  if (p.job.source === "qa_test") {
    const r = await d.sendTestSms(p.e164, body, p.job, `${text}:${key}`, ROLE[p.kind]);
    return r.status === "sent" ? "sent" : `held: ${r.detail}`;
  }
  const r = await d.sendSms({ type: text, idempotencyKey: key, to: p.e164, body, jobId: p.job.id, ...(event ? { event } : {}) });
  if (r.status === "sent" || r.status === "sent_unknown") return "sent";
  if (r.status === "already") return "already handled";
  return `held: ${r.detail}`;
}

/** PIESA / install booked → ONE "You're booked" text to the person who lets the trades in. Returns what happened; never throws for a normal hold. */
export async function textAccessPersonBooked(jobId: string, bookingId: string, now = new Date(), over: Partial<AccessPersonTextDeps> = {}): Promise<string> {
  const d = { ...defaults(), ...over };
  if (!d.approved) return "awaiting approval";
  const p = await prepare(jobId, bookingId, now, d);
  if (typeof p === "string") return p;
  if (d.quiet(now)) return QUIET_HOURS_WAIT;
  const whoName = (await d.whoName(jobId, bookingId)) ?? "Someone";
  const body = accessPersonBookedText({ kind: p.kind, firstName: null, startIso: p.booking.scheduled_start, whoName, business: p.business, changed: false }, p.access);
  return deliver(p, ACCESS_PERSON_BOOKED_SMS_TYPE, body, accessPersonKey.booked(p.booking.id, p.e164), d, { at: p.booking.created_at, current: true });
}

/** The afternoon before a PIESA / install → ONE "See you tomorrow" text to the person who lets the trades in. */
export async function textAccessPersonTomorrow(jobId: string, bookingId: string, now = new Date(), over: Partial<AccessPersonTextDeps> = {}): Promise<string> {
  const d = { ...defaults(), ...over };
  if (!d.approved) return "awaiting approval";
  const p = await prepare(jobId, bookingId, now, d);
  if (typeof p === "string") return p;
  if (!visitTomorrowDue(now, p.booking.scheduled_start)) return "not due";
  if (d.quiet(now)) return QUIET_HOURS_WAIT;
  const { melbourneClock } = await import("./installer-texts.core");
  const body = accessPersonTomorrowText({ kind: p.kind, time: melbourneClock(p.booking.scheduled_start), business: p.business }, p.access);
  return deliver(p, ACCESS_PERSON_TOMORROW_SMS_TYPE, body, accessPersonKey.tomorrow(p.booking.id, p.e164), d);
}
