// Decision #23 (Jo 2 Nov 2026): when Jo gives the job to an in-house installer, the owner gets "{Installer} will call you"
// (email + `owner_will_call` text), built from the pure owner-will-call.core with the installer's OFFICE phone and email
// (businessContactForJob). Allocation records intent only (`in_house_partner_call_email_pending`); this sender and the tick
// sweep do the rest. The old draft DB template `in_house_partner_will_call` is no longer read (it stays a draft).
// - Off while OWNER_WILL_CALL_APPROVED is false: "awaiting approval", nothing recorded or sent (only the photo-give read below).
// - One version per job: purpose `in_house_partner_call` and key `in-house-partner-call:v1:{job}` are unchanged, so a job
//   that already has a send under that purpose (the old wording) gets nothing more.
// - No back-send: a job past the Ready Check booking step or with a confirmed Ready Check booking gets nothing.
// - No office phone / business email / installer → ONE `owner_will_call_held` office event per reason, nothing sent;
//   the tick retries, so it goes once the office fixes the business details.
// - Quiet hours (8pm–7am Melbourne): waits for the tick so the email and the text go together.
// - Both channels after assertCustomerDeliveryAllowed; the email through the guarded owner sender, the text through the
//   one real SMS sender (its own switch, STOP, consent) and only once the email has gone.
// Photo-quote installers (Jo 5 Nov 2026, spec decision 3): a job under a "From photos" give (`photoGiveFor`) never gets
// this email or its text. It gets ONE "Good news: no visit needed" email (owner-photo-quote-notice.core), keyed per job +
// give, behind its own switch OWNER_PHOTO_QUOTE_NOTICE_APPROVED (off → one `owner_photo_quote_notice_held` event per give,
// nothing sent); TEST jobs go through test-send. No text.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { BusinessContact } from "./owner-wording.core";
import { willCallAllowed, OWNER_WILL_CALL_APPROVED, OWNER_WILL_CALL_HELD_EVENT, OWNER_WILL_CALL_SMS_TYPE, ownerWillCallEmail, ownerWillCallText } from "./owner-will-call.core";
import { STAGE_ORDER } from "./workflow";
import { smsQuietReason } from "./quote-hold.core";
import type { RealSmsInput, RealSmsResult } from "./sms.server";
import { displayName } from "./display-name.core";
import { OWNER_PHOTO_QUOTE_NOTICE_APPROVED, OWNER_PHOTO_QUOTE_NOTICE_HELD_EVENT, OWNER_PHOTO_QUOTE_NOTICE_PURPOSE, ownerPhotoQuoteEmail, ownerPhotoQuoteNoticeKey } from "./owner-photo-quote-notice.core";
import { PHOTO_QUOTE_GIVE_EVENT, type PhotoGive } from "./photo-quote.core";
import { chunkIds } from "./sweep-batch.core";

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
  photoApproved: boolean;
  photoGive: (jobId: string, db: WillCallDeps["db"]) => Promise<PhotoGive | null>;
  /** TEST jobs only: once per key through test-send. Returns the outcome word. */
  sendTest: (p: { jobId: string; jobSource: string | null; to: string; key: string; mail: Mail }) => Promise<string>;
  firmQuote: (jobId: string) => Promise<boolean>;
};
const defaults = (): WillCallDeps => ({
  db: admin as unknown as WillCallDeps["db"],
  firmQuote: async (jobId) => (await import("./firm-quote.server")).isFirmQuoteJobId(jobId),
  approved: OWNER_WILL_CALL_APPROVED,
  now: () => new Date(),
  // Jo 2 Nov 2026 (#126): names the owner reads show in normal case ("RAPID INSULATION" → "Rapid Insulation"); display only.
  contactFor: async (jobId) => {
    const c = await (await import("./owner-contact.server")).businessContactForJob(jobId, "installer");
    return c ? { ...c, name: displayName(c.name), tradingName: c.tradingName ? displayName(c.tradingName) : null } : null;
  },
  assertAllowed: async (jobId, what) => (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, what),
  sendEmail: async (p) => (await import("./owner-email-send.server")).sendGuardedOwnerEmail(p),
  sendSms: async (input) => (await import("./sms.server")).sendRealSms(input),
  logEvent: async (...a) => (await import("./workflow.server")).logEvent(...(a as Parameters<typeof import("./workflow.server").logEvent>)),
  photoApproved: OWNER_PHOTO_QUOTE_NOTICE_APPROVED,
  photoGive: async (jobId, db) => (await import("./photo-quote.server")).photoGiveFor(jobId, db),
  sendTest: async (p) => {
    let detail = "";
    const sent = await (await import("./in-house-booking-notices.server")).deliverOnce(p.jobId, p.key, { to: p.to, ...p.mail }, async (frozen) => {
      const r = await (await import("./test-send.server")).sendTestEmail({ jobId: p.jobId, jobSource: p.jobSource, partnerIsTest: false, label: "owner_photo_quote_notice", actorId: null }, frozen.to, frozen.subject, frozen.html, frozen.text);
      detail = r.detail; return r;
    });
    return sent ? "test_sent" : `not sent${detail ? `: ${detail}` : " (already tried)"}`;
  },
});
const WHAT = "Installer will call you email";
const firstWord = (full: string | null | undefined) => (full ?? "").trim().split(/\s+/)[0] || null;

/** Past the Ready Check booking step (or closed) → the owner is already being looked after; never back-send. */
const pastBookingStep = (stage: string) => ["cancelled", "complete"].includes(stage) || STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]) > LAST_STAGE;

export async function sendInHousePartnerCall(jobId: string, over: Partial<WillCallDeps> = {}): Promise<string> {
  const d = { ...defaults(), ...over };
  if (await d.firmQuote(jobId)) return "firm_quote_job";
  // Photo-quote installers: never "will call you" (email or text) on a From photos give. While the will-call switch is
  // off only the photo notice can go, and a failed read changes nothing ("awaiting approval", as before); with it on,
  // the give is read with the other safeguards and any failed read stops the send the same way.
  if (!d.approved) {
    const photo = await d.photoGive(jobId, d.db).catch(() => null);
    return photo ? sendOwnerPhotoQuoteNotice(jobId, photo, d) : "awaiting approval";
  }
  const db = d.db;
  const [photoRead, job, pending, assignments, ledger, booked] = await Promise.all([
    d.photoGive(jobId, db).then((give) => ({ give }), () => null),
    db.from("jobs").select("id,source,stage,channel,owners(email,full_name,phone)").eq("id", jobId).is("deleted_at", null).neq("source", "qa_test").maybeSingle(),
    db.from("workflow_events").select("job_id,details,created_at").eq("job_id", jobId).eq("event_type", PENDING).order("created_at").limit(1).maybeSingle(),
    db.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true),
    db.from("customer_email_sends").select("id").eq("job_id", jobId).eq("purpose", PURPOSE).limit(1),
    db.from("bookings").select("job_id").eq("job_id", jobId).eq("kind", "ready_check").eq("status", "confirmed").limit(1),
  ]);
  if (!photoRead || job.error || pending.error || assignments.error || ledger.error || booked.error) throw new Error("Could not read partner call email safeguards.");
  if (photoRead.give) return sendOwnerPhotoQuoteNotice(jobId, photoRead.give, d);
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

const PHOTO_WHAT = "No visit needed email";
/** Spec decision 3: the owner's ONE email when the job goes to a From photos installer. Same no-back-send rule and holds as
 *  will-call; once per job + give (key and `customer_email_sends` purpose); no text. */
async function sendOwnerPhotoQuoteNotice(jobId: string, give: PhotoGive, d: WillCallDeps): Promise<string> {
  if (await d.firmQuote(jobId)) return "firm_quote_job";
  const db = d.db;
  const key = ownerPhotoQuoteNoticeKey(jobId, give.batchId);
  const [job, ledger, prior] = await Promise.all([
    db.from("jobs").select("id,source,stage,channel,owners(email,full_name,phone)").eq("id", jobId).is("deleted_at", null).maybeSingle(),
    db.from("customer_email_sends").select("id").eq("job_id", jobId).eq("purpose", OWNER_PHOTO_QUOTE_NOTICE_PURPOSE).eq("idempotency_key", key).limit(1),
    db.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", OWNER_PHOTO_QUOTE_NOTICE_HELD_EVENT),
  ]);
  if (job.error || ledger.error || prior.error) throw new Error("Could not read no visit needed email safeguards.");
  if (job.data && !willCallAllowed((job.data as { channel?: string | null }).channel ?? null)) return "not applicable: installer's own customer";
  const owner = job.data?.owners as { email: string | null; full_name: string | null } | null;
  if (!job.data || pastBookingStep(job.data.stage) || !owner?.email) return "not applicable";
  if ((ledger.data ?? []).length) return "already attempted";
  const test = job.data.source === "qa_test";
  const held = async (reason: string, summary: string) => {
    if (!((prior.data ?? []) as { details: { reason?: string; batch_id?: string } | null }[]).some(r => r.details?.reason === reason && r.details?.batch_id === give.batchId))
      await d.logEvent(jobId, null, OWNER_PHOTO_QUOTE_NOTICE_HELD_EVENT, summary, { reason, batch_id: give.batchId, business_id: give.businessId }, { internal: true });
  };
  if (!test && !d.photoApproved) {
    await held("awaiting approval", `"Good news: no visit needed" not sent — the wording is waiting for Jo's approval.`);
    return "awaiting approval";
  }
  const contact = await d.contactFor(jobId);
  const first = firstWord(owner.full_name);
  const preview = contact ? ownerPhotoQuoteEmail({ firstName: first, installer: contact, unsubscribeUrl: null, test }) : { held: "No installer business on file" };
  if ("held" in preview) {
    await held(preview.held, `"Good news: no visit needed" not sent — ${preview.held}. Add it on the business, then it goes automatically.`);
    return `held: ${preview.held}`;
  }
  if (test) return d.sendTest({ jobId, jobSource: job.data.source, to: owner.email, key, mail: preview });
  try { await d.assertAllowed(jobId, PHOTO_WHAT); } catch { return "messages held"; }
  return d.sendEmail({ jobId, jobSource: job.data.source, to: owner.email, purpose: OWNER_PHOTO_QUOTE_NOTICE_PURPOSE, key,
    beforeSend: () => d.assertAllowed(jobId, PHOTO_WHAT),
    build: (unsubscribeUrl) => ownerPhotoQuoteEmail({ firstName: first, installer: contact!, unsubscribeUrl }) as Mail,
  });
}

/** Jobs with a photo method record — only these can be under a From photos give (one extra read each, few jobs). */
async function photoGivesAmong(d: WillCallDeps, ids: string[]): Promise<Map<string, PhotoGive>> {
  const marked = new Set<string>();
  for (const chunk of chunkIds(ids)) {
    const r = await d.db.from("workflow_events").select("job_id").in("job_id", chunk).eq("event_type", PHOTO_QUOTE_GIVE_EVENT);
    if (r.error) throw new Error("Could not read how jobs are quoted.");
    for (const row of (r.data ?? []) as { job_id: string }[]) marked.add(row.job_id);
  }
  const out = new Map<string, PhotoGive>();
  for (const id of marked) { const g = await d.photoGive(id, d.db); if (g) out.set(id, g); }
  return out;
}

export async function sweepInHousePartnerCalls(over: Partial<WillCallDeps> = {}): Promise<{ checked: number; sent: number }> {
  const d = { ...defaults(), ...over };
  if (!d.approved && !d.photoApproved) return { checked: 0, sent: 0 };
  // Read only current real jobs; exclude attempts BEFORE limiting so sent history cannot starve new pending jobs.
  const events = await d.db.from("workflow_events").select("job_id,jobs!inner(id,channel)").eq("event_type", PENDING)
    .is("jobs.deleted_at", null).neq("jobs.source", "qa_test").order("created_at");
  if (events.error) throw new Error("Could not read pending partner call emails.");
  // Part 10 Task 8: installers' own customers are never candidates (the sender refuses them too).
  const ids = [...new Set(((events.data ?? []) as { job_id: string | null; jobs?: { channel?: string | null } | null }[]).flatMap(e => e.job_id && willCallAllowed(e.jobs?.channel ?? null) ? [e.job_id] : []))];
  if (!ids.length) return { checked: 0, sent: 0 };
  // Photo jobs: attempted = a send under the photo purpose for THIS give; they are candidates only while that switch is on.
  // Ready Check jobs: as before, only while the will-call switch is on. Filtered BEFORE the limit so neither starves the other.
  const photo = await photoGivesAmong(d, ids);
  const attempted = new Set<string>();
  for (const chunk of chunkIds(ids)) {
    const attempts = await d.db.from("customer_email_sends").select("job_id,purpose,idempotency_key").in("job_id", chunk).in("purpose", [PURPOSE, OWNER_PHOTO_QUOTE_NOTICE_PURPOSE]);
    if (attempts.error) throw new Error("Could not read partner call email attempts.");
    for (const a of (attempts.data ?? []) as { job_id: string; purpose: string; idempotency_key?: string | null }[]) {
      const g = photo.get(a.job_id);
      if (g ? a.purpose === OWNER_PHOTO_QUOTE_NOTICE_PURPOSE && a.idempotency_key === ownerPhotoQuoteNoticeKey(a.job_id, g.batchId) : a.purpose === PURPOSE) attempted.add(a.job_id);
    }
  }
  const candidates = ids.filter(id => !attempted.has(id) && (photo.has(id) ? d.photoApproved : d.approved)).slice(0, 50);
  let sent = 0;
  for (const id of candidates) {
    try {
      const g = photo.get(id);
      if ((g ? await sendOwnerPhotoQuoteNotice(id, g, d) : await sendInHousePartnerCall(id, d)) === "sent") sent++;
    }
    catch (error) { console.error("Partner call email sweep failed", error instanceof Error ? error.message : "unknown"); }
  }
  return { checked: candidates.length, sent };
}
