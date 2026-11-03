// Decision #23 (Jo 2 Nov 2026): when Jo gives the job to an in-house installer, the owner gets "{Installer} will call you"
// (email + `owner_will_call` text), built from the pure owner-will-call.core with the installer's OFFICE phone and email
// (businessContactForJob). Allocation records intent only (`in_house_partner_call_email_pending`); this sender and the tick
// sweep do the rest. The old draft DB template `in_house_partner_will_call` is no longer read (it stays a draft).
// - Off while OWNER_WILL_CALL_APPROVED is false: "awaiting approval", nothing read, recorded or sent.
// - One version per job: purpose `in_house_partner_call` and key `in-house-partner-call:v1:{job}` are unchanged, so a job
//   that already has a send under that purpose (the old wording) gets nothing more.
// - No back-send: a job past the Ready Check booking step or with a confirmed Ready Check booking gets nothing.
// - No office phone / business email / installer → ONE `owner_will_call_held` office event per reason, nothing sent;
//   the tick retries, so it goes once the office fixes the business details.
// - Quiet hours (8pm–7am Melbourne): waits for the tick so the email and the text go together.
// - Both channels after assertCustomerDeliveryAllowed; the email through the guarded owner sender, the text through the
//   one real SMS sender (its own switch, STOP, consent) and only once the email has gone.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { BusinessContact } from "./owner-wording.core";
import { willCallAllowed, OWNER_WILL_CALL_APPROVED, OWNER_WILL_CALL_HELD_EVENT, OWNER_WILL_CALL_SMS_TYPE, ownerWillCallEmail, ownerWillCallText } from "./owner-will-call.core";
import { STAGE_ORDER } from "./workflow";
import { smsQuietReason } from "./quote-hold.core";
import type { RealSmsInput, RealSmsResult } from "./sms.server";

const PURPOSE = "in_house_partner_call";
const PENDING = "in_house_partner_call_email_pending";
const LAST_STAGE = STAGE_ORDER.indexOf("ready_check_ready_to_schedule");
type Pending = { job_id: string; details: { business_id?: string; batch_id?: string; partner_trading_name?: string } | null };
type Mail = { subject: string; html: string; text: string };

export type WillCallDeps = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { from: (table: string) => any };
  approved: boolean;
  now: () => Date;
  contactFor: (jobId: string) => Promise<BusinessContact | null>;
  assertAllowed: (jobId: string, what: string) => Promise<void>;
  sendEmail: (p: { jobId: string; jobSource: string | null; to: string; purpose: string; key: string; beforeSend?: () => Promise<void>; build: (unsubscribeUrl: string | null) => Mail }) => Promise<string>;
  sendSms: (input: RealSmsInput) => Promise<RealSmsResult>;
  logEvent: (jobId: string, actorId: string | null, type: string, summary: string, details?: Record<string, unknown>, opts?: { internal?: boolean }) => Promise<unknown>;
};
const defaults = (): WillCallDeps => ({
  db: admin as unknown as WillCallDeps["db"],
  approved: OWNER_WILL_CALL_APPROVED,
  now: () => new Date(),
  contactFor: async (jobId) => (await import("./owner-contact.server")).businessContactForJob(jobId, "installer"),
  assertAllowed: async (jobId, what) => (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, what),
  sendEmail: async (p) => (await import("./owner-email-send.server")).sendGuardedOwnerEmail(p),
  sendSms: async (input) => (await import("./sms.server")).sendRealSms(input),
  logEvent: async (...a) => (await import("./workflow.server")).logEvent(...(a as Parameters<typeof import("./workflow.server").logEvent>)),
});
const WHAT = "Installer will call you email";
const firstWord = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || null;

/** Past the Ready Check booking step (or closed) → the owner is already being looked after; never back-send. */
const pastBookingStep = (stage: string) => ["cancelled", "complete"].includes(stage) || STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]) > LAST_STAGE;

export async function sendInHousePartnerCall(jobId: string, over: Partial<WillCallDeps> = {}): Promise<string> {
  const d = { ...defaults(), ...over };
  if (!d.approved) return "awaiting approval";
  const db = d.db;
  const [job, pending, assignments, ledger, booked] = await Promise.all([
    db.from("jobs").select("id,source,stage,channel,owners(email,full_name,phone)").eq("id", jobId).is("deleted_at", null).neq("source", "qa_test").maybeSingle(),
    db.from("workflow_events").select("job_id,details,created_at").eq("job_id", jobId).eq("event_type", PENDING).order("created_at").limit(1).maybeSingle(),
    db.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true),
    db.from("customer_email_sends").select("id").eq("job_id", jobId).eq("purpose", PURPOSE).limit(1),
    db.from("bookings").select("job_id").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").limit(1),
  ]);
  if (job.error || pending.error || assignments.error || ledger.error || booked.error) throw new Error("Could not read partner call email safeguards.");
  // Part 10 Task 8: an installer's own customer never gets this (before any claim, send or held note).
  if (job.data && !willCallAllowed((job.data as { channel?: string | null }).channel ?? null)) return "not applicable: installer's own customer";
  const details = (pending.data as Pending | null)?.details;
  const owner = job.data?.owners as { email: string | null; full_name: string | null; phone: string | null } | null;
  if (!job.data || pastBookingStep(job.data.stage) || (booked.data ?? []).length || !owner?.email || !details?.business_id
    || !(assignments.data as { business_id: string }[] | null)?.some(a => a.business_id === details.business_id)) return "not applicable";
  // One version per job: any earlier send under this purpose (old draft wording included) means nothing more is sent.
  if ((ledger.data ?? []).length) return "already attempted";
  if (smsQuietReason(d.now().toISOString())) return "quiet hours";
  try { await d.assertAllowed(jobId, WHAT); } catch { return "messages held"; }

  const contact = await d.contactFor(jobId);
  const first = firstWord(owner.full_name);
  const preview = contact ? ownerWillCallEmail({ firstName: first, installer: contact, unsubscribeUrl: null }) : { held: "No installer business on file" };
  if ("held" in preview) {
    const prior = await db.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", OWNER_WILL_CALL_HELD_EVENT);
    if (prior.error) throw new Error("Could not read held partner call notes.");
    if (!(prior.data as { details: { reason?: string } | null }[] | null ?? []).some(r => r.details?.reason === preview.held)) {
      await d.logEvent(jobId, null, OWNER_WILL_CALL_HELD_EVENT, `"Installer will call you" not sent — ${preview.held}. Add it on the business, then it goes automatically.`,
        { reason: preview.held, business_id: details.business_id, decision: 23 }, { internal: true });
    }
    return `held: ${preview.held}`;
  }
  const status = await d.sendEmail({ jobId, jobSource: job.data.source, to: owner.email, purpose: PURPOSE, key: `in-house-partner-call:v1:${jobId}`,
    beforeSend: () => d.assertAllowed(jobId, WHAT),
    build: (unsubscribeUrl) => ownerWillCallEmail({ firstName: first, installer: contact!, unsubscribeUrl }) as Mail,
  });
  const went = status === "sent" || status.startsWith("delivery uncertain");
  const body = ownerWillCallText(first, contact!);
  if (went && owner.phone && typeof body === "string") {
    try {
      await d.assertAllowed(jobId, "Installer will call you text");
      await d.sendSms({ type: OWNER_WILL_CALL_SMS_TYPE, idempotencyKey: `in-house-partner-call:v1:${jobId}:sms`, to: owner.phone, body, jobId });
    } catch (error) { console.error("Partner call text failed", error instanceof Error ? error.message : "unknown"); }
  }
  return status;
}

export async function sweepInHousePartnerCalls(over: Partial<WillCallDeps> = {}): Promise<{ checked: number; sent: number }> {
  const d = { ...defaults(), ...over };
  if (!d.approved) return { checked: 0, sent: 0 };
  // Read only current real jobs; exclude attempts BEFORE limiting so sent history cannot starve new pending jobs.
  const events = await d.db.from("workflow_events").select("job_id,jobs!inner(id,channel)").eq("event_type", PENDING)
    .is("jobs.deleted_at", null).neq("jobs.source", "qa_test").order("created_at");
  if (events.error) throw new Error("Could not read pending partner call emails.");
  // Part 10 Task 8: installers' own customers are never candidates (the sender refuses them too).
  const ids = [...new Set(((events.data ?? []) as { job_id: string | null; jobs?: { channel?: string | null } | null }[]).flatMap(e => e.job_id && willCallAllowed(e.jobs?.channel ?? null) ? [e.job_id] : []))];
  if (!ids.length) return { checked: 0, sent: 0 };
  const attempts = await d.db.from("customer_email_sends").select("job_id").in("job_id", ids).eq("purpose", PURPOSE);
  if (attempts.error) throw new Error("Could not read partner call email attempts.");
  const attempted = new Set(((attempts.data ?? []) as { job_id: string }[]).map(a => a.job_id));
  const candidates = ids.filter(id => !attempted.has(id)).slice(0, 50);
  let sent = 0;
  for (const id of candidates) {
    try { if (await sendInHousePartnerCall(id, d) === "sent") sent++; }
    catch (error) { console.error("Partner call email sweep failed", error instanceof Error ? error.message : "unknown"); }
  }
  return { checked: candidates.length, sent };
}
