// Reads the facts behind "is this enquiry waiting for the owner's full address?". Read-only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ADDRESS_REQUEST_ANSWERED_EVENT, ADDRESS_REQUEST_REMINDER_EVENT, ADDRESS_REQUEST_SENT_EVENT, type AddressRequestFacts } from "./address-request.core";

const loose = admin as unknown as SupabaseClient;

/** null = switched off (column missing, unreadable or empty). */
async function readGoLiveAt(): Promise<string | null> {
  const { data, error } = await loose.from("workflow_settings").select("address_request_live_at").eq("id", 1).maybeSingle();
  const v = error || !data ? null : (data as Record<string, unknown>)["address_request_live_at"];
  return typeof v === "string" && v ? v : null;
}

async function firstEventAt(jobId: string, type: string): Promise<string | null> {
  const { data } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", type).order("created_at", { ascending: true }).limit(1);
  return data?.[0]?.created_at ?? null;
}

export async function loadAddressRequestFacts(jobId: string): Promise<AddressRequestFacts | null> {
  const { data: job, error } = await admin.from("jobs").select("source, channel, created_at, properties(address_line)").eq("id", jobId).maybeSingle();
  if (error || !job) return null;
  const [goLiveAt, sentAt, reminderAt, answeredAt] = await Promise.all([
    readGoLiveAt(),
    firstEventAt(jobId, ADDRESS_REQUEST_SENT_EVENT),
    firstEventAt(jobId, ADDRESS_REQUEST_REMINDER_EVENT),
    firstEventAt(jobId, ADDRESS_REQUEST_ANSWERED_EVENT),
  ]);
  const property = job.properties as unknown as { address_line: string | null } | null;
  return { addressLine: property?.address_line ?? null, source: job.source ?? null, channel: job.channel ?? null, createdAt: job.created_at, goLiveAt, sentAt, reminderAt, answeredAt };
}

// ---- 15-minute tick: send the request, then ONE reminder 24h later ------------------------------------------------
// Candidates: only while address_request_live_at is set; website/email enquiries (hivic_sourced) created since go-live,
// not deleted, not cancelled/complete. The pure rule (addressRequestStep) decides per job. Email through the one guarded
// owner-email path; text through the one real SMS sender (switch, wording approval, quiet hours, consent, STOP live there).
// The event is logged once per step; the 24h reminder clock runs from the request event. A text held only for quiet hours
// (8pm–7am) is tried again on later ticks under the SAME key until it goes, without a second event.

export type AddressRequestSweep = { sent: number; reminded: number };
type Candidate = { id: string; source: string | null; channel: string | null; created_at: string; owners: { email: string | null; phone: string | null } | null; properties: { address_line: string | null } | null };
type EventRow = { job_id: string; event_type: string; created_at: string };
/** At most this many jobs are actually messaged per tick (a job with no usable owner link doesn't use one up). */
const SWEEP_BATCH = 50;
/** Owner-link checks per tick (each may prepare a link), so jobs that can't get a link never starve the rest for long. */
const LINK_CHECK_CAP = 150;

async function ownerPickUrl(jobId: string): Promise<string | null> {
  const { ensureOwnerLink } = await import("./estimatelink.server");
  if (!(await ensureOwnerLink(jobId).catch(() => false))) return null;
  const { LINK_PURPOSE, linkUsable } = await import("./estimatelink.core");
  const { data: link } = await admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", LINK_PURPOSE).eq("status", "active").maybeSingle();
  if (!link?.token || !linkUsable(link)) return null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { addressRequestPageUrl } = await import("./address-request.core");
  return addressRequestPageUrl(CUSTOMER_BASE, link.token);
}

const smsTypeFor = (reminder: boolean) => (reminder ? "address_request_reminder" : "address_request") as "address_request" | "address_request_reminder";

async function sendText(jobId: string, phone: string | null, url: string, reminder: boolean) {
  const { addressRequestKey, addressRequestText } = await import("./address-request.core");
  const { sendRealSms } = await import("./sms.server");
  return sendRealSms({ type: smsTypeFor(reminder), idempotencyKey: addressRequestKey(jobId, reminder), to: phone, body: addressRequestText(url, reminder), jobId });
}

/** Customer messages on AND this text's own switch on (the gates the sender checks after quiet hours). */
async function textGatesOn(type: string): Promise<boolean> {
  const { customerCommsEnabled } = await import("./comms.server");
  if (!(await customerCommsEnabled())) return false;
  const { data } = await loose.from("workflow_settings").select("sms_message_switches").eq("id", 1).maybeSingle();
  const sw = (data as { sms_message_switches?: Record<string, unknown> } | null)?.sms_message_switches;
  return sw?.[type] === true;
}

/** One step for one job: email + text, then the event (only when something was actually attempted). */
async function runStep(j: Candidate, reminder: boolean, url: string): Promise<"logged" | "skipped"> {
  const C = await import("./address-request.core");
  const key = C.addressRequestKey(j.id, reminder);
  let email = "not sent — no owner email";
  if (j.owners?.email) {
    try {
      await (await import("./comms.server")).assertCustomerDeliveryAllowed(j.id, reminder ? "Full address reminder email" : "Full address request email");
      const { renderAddressRequestEmail } = await import("./address-request-email.core");
      email = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId: j.id, jobSource: j.source, to: j.owners.email, purpose: reminder ? C.ADDRESS_REQUEST_REMINDER_PURPOSE : C.ADDRESS_REQUEST_PURPOSE, key, build: (u) => renderAddressRequestEmail({ pickUrl: url, unsubscribeUrl: u, reminder }) });
    } catch (e) { email = `not sent — ${(e as Error).message}`; }
  }
  let sms: { status: string; detail: string };
  try { const t = await sendText(j.id, j.owners?.phone ?? null, url, reminder); sms = { status: t.status, detail: t.detail }; }
  catch (e) { sms = { status: "error", detail: (e as Error).message }; }
  const { SMS_QUIET_REASON } = await import("./quote-hold.core");
  // Nothing really attempted (e.g. customer messages off, wording not approved, text switch off): log nothing, so the
  // job is asked on a later tick; the once-only keys keep that to one send per channel.
  const textWillGoAt7am = sms.detail === SMS_QUIET_REASON && (await textGatesOn(smsTypeFor(reminder)));
  if (!C.addressRequestAttempted(email, sms, { reason: SMS_QUIET_REASON, textWillGoAt7am })) return "skipped";
  const { logEvent } = await import("./workflow.server");
  await logEvent(j.id, null, reminder ? ADDRESS_REQUEST_REMINDER_EVENT : ADDRESS_REQUEST_SENT_EVENT,
    reminder ? "Reminder sent to the owner: we still need their full address" : "Owner asked for their full address (email + text)",
    { idempotency_key: key, email, sms, sms_waits_for_7am: sms.detail === SMS_QUIET_REASON }, { internal: true });
  return "logged";
}

export async function sweepAddressRequests(now: number = Date.now()): Promise<AddressRequestSweep> {
  const out: AddressRequestSweep = { sent: 0, reminded: 0 };
  const goLiveAt = await readGoLiveAt();
  if (!goLiveAt) return out;
  const C = await import("./address-request.core");
  const { smsQuietReason, SMS_QUIET_REASON } = await import("./quote-hold.core");
  const { claimKeyOf } = await import("./sms.core");

  const jobs: Candidate[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await loose.from("jobs").select("id, source, channel, created_at, owners(email, phone), properties(address_line)")
      .in("source", ["base44", "email"]).eq("channel", "hivic_sourced").gte("created_at", goLiveAt).is("deleted_at", null)
      .not("stage", "in", "(cancelled,complete)").order("created_at", { ascending: true }).order("id").range(from, from + 999);
    if (error) throw new Error(`Could not read enquiries for the address request: ${error.message}`);
    jobs.push(...((data ?? []) as unknown as Candidate[]));
    if (!data || data.length < 1000) break;
  }
  // Cheap pure filter first (no street), so the event read only covers jobs that could be waiting.
  const noStreet = jobs.filter((j) => C.addressRequestOpen({ addressLine: j.properties?.address_line ?? null, source: j.source, channel: j.channel, createdAt: j.created_at, goLiveAt, sentAt: null, reminderAt: null, answeredAt: null }));
  if (!noStreet.length) return out;
  const { readByJobIds } = await import("./sweep-batch.server");
  const ids = noStreet.map((j) => j.id);
  const evs = await readByJobIds<EventRow>("address request history", ids, (c) => loose.from("workflow_events").select("job_id, event_type, created_at").in("job_id", c).in("event_type", [ADDRESS_REQUEST_SENT_EVENT, ADDRESS_REQUEST_REMINDER_EVENT, ADDRESS_REQUEST_ANSWERED_EVENT]));
  const first = (jobId: string, type: string) => evs.filter((e) => String(e.job_id) === jobId && e.event_type === type).map((e) => e.created_at).sort()[0] ?? null;

  type Work = { job: Candidate; kind: "send" | "remind" | "retry_send" | "retry_remind" };
  const work: Work[] = [];
  const retryCandidates: { job: Candidate; reminder: boolean }[] = [];
  for (const j of noStreet) {
    const f: AddressRequestFacts = { addressLine: j.properties?.address_line ?? null, source: j.source, channel: j.channel, createdAt: j.created_at, goLiveAt,
      sentAt: first(j.id, ADDRESS_REQUEST_SENT_EVENT), reminderAt: first(j.id, ADDRESS_REQUEST_REMINDER_EVENT), answeredAt: first(j.id, ADDRESS_REQUEST_ANSWERED_EVENT) };
    if (!C.addressRequestOpen(f)) continue;
    const step = C.addressRequestStep(f, now);
    if (step !== "none") { work.push({ job: j, kind: step }); continue; }
    if (f.sentAt) retryCandidates.push({ job: j, reminder: false });
    if (f.reminderAt) retryCandidates.push({ job: j, reminder: true });
  }
  // Texts held only for quiet hours: tried again (same key) once it is 7am or later. Never during quiet hours.
  if (retryCandidates.length && !smsQuietReason(new Date(now).toISOString())) {
    const keys = retryCandidates.map((r) => C.addressRequestKey(r.job.id, r.reminder));
    const rows = await readByJobIds<{ idempotency_key: string; detail: string | null }>("address request texts", [...new Set(retryCandidates.map((r) => r.job.id))],
      (c) => loose.from("sms_messages").select("idempotency_key, detail").in("job_id", c).in("message_type", ["address_request", "address_request_reminder"]));
    for (const [n, r] of retryCandidates.entries()) {
      const mine = rows.filter((x) => claimKeyOf(String(x.idempotency_key)) === keys[n]);
      // Only while every attempt so far was a quiet-hours hold (a claimed send or any other hold ends it).
      if (mine.length && mine.every((x) => x.detail === SMS_QUIET_REASON && x.idempotency_key !== keys[n])) work.push({ job: r.job, kind: r.reminder ? "retry_remind" : "retry_send" });
    }
  }
  work.sort((a, b) => a.job.created_at.localeCompare(b.job.created_at));
  // Oldest first. Jobs with no usable owner link are skipped (nothing logged, tried next tick) and don't use up the batch.
  let messaged = 0, linkChecks = 0;
  const run = async (w: Work, url: string) => {
    try {
      if (w.kind === "send") { if ((await runStep(w.job, false, url)) === "logged") out.sent++; }
      else if (w.kind === "remind") { if ((await runStep(w.job, true, url)) === "logged") out.reminded++; }
      else await sendText(w.job.id, w.job.owners?.phone ?? null, url, w.kind === "retry_remind");
    } catch (e) { console.error("address request step failed", w.job.id, (e as Error).message); }
  };
  for (let i = 0; i < work.length && messaged < SWEEP_BATCH && linkChecks < LINK_CHECK_CAP; ) {
    const slice = work.slice(i, i + Math.min(4, SWEEP_BATCH - messaged, LINK_CHECK_CAP - linkChecks));
    i += slice.length; linkChecks += slice.length;
    const urls = await Promise.all(slice.map((w) => ownerPickUrl(w.job.id).catch(() => null)));
    const ready = slice.flatMap((w, n) => (urls[n] ? [{ w, url: urls[n]! }] : []));
    messaged += ready.length;
    await Promise.all(ready.map((r) => run(r.w, r.url)));
  }
  return out;
}
