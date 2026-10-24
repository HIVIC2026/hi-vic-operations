// Office actions behind the redesigned screens (O2 More menu, O3/O4 Actions, O4 inline fix, O1 email rows).
// Every change is audited through workflow_events and uses the existing guarded paths; nothing here sends a message.
// Server-only; callers (office-screens.functions.ts) have already checked requireAdmin.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { fixDetailsErrors, tidyEnquiryDetails } from "./name-address-tidy.core";
import { reopenBlocker } from "./office-jobs.core";
import { EMAIL_CHANGE_REQUEST_EVENT, EMAIL_CHANGE_RESOLVED_EVENT, EMAIL_UNMATCHED_EVENT, EMAIL_UNMATCHED_RESOLVED_EVENT, openEmailAsks, type AskEvent } from "./email-asks.core";

/** Owner email / installer text on Cancel and Hold: the dialog is approved (228) but the wording is not yet (227), so the
 *  ticks are recorded for the office and NOTHING is sent until Jo approves the wording and a guarded sender exists. */
export const CANCEL_HOLD_NOTICE_WORDING_APPROVED = false;

export type TellTicks = { owner: boolean; installer: boolean };

/**
 * Decision 227: Cancel at any time. Reason required; moves the job to Closed; stops reminders and texts (every reminder
 * path skips cancelled jobs, and open ESC notices are cancelled); releases any held install day and the installer
 * (future bookings cancelled, open day offers superseded, pending trade offers withdrawn, active assignments ended);
 * keeps history (nothing deleted). Owner email / installer text only when ticked — recorded, not sent (wording to approve).
 */
export async function cancelJobFully(jobId: string, reason: string, actorId: string, opts: { note?: string | null; tell?: TellTicks; bulk?: boolean } = {}) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const { data: job, error } = await admin.from("jobs").select("stage, job_number").eq("id", jobId).maybeSingle();
  if (error || !job) throw new WorkflowError("Job not found.");
  if (job.stage === "cancelled") throw new WorkflowError(`${job.job_number} is already cancelled.`);
  if (job.stage === "complete") throw new WorkflowError(`${job.job_number} is complete — a completed job cannot be cancelled.`);
  const full = opts.note?.trim() ? `${reason.trim()} · ${opts.note.trim()}` : reason.trim();
  const { applyHoldOrCancel } = await import("./job-disposition.server");
  await applyHoldOrCancel(jobId, "cancel", full, actorId, { decision: 227, reason: reason.trim(), note: opts.note?.trim() || null, ...(opts.bulk ? { bulk: true } : {}) });
  const now = new Date().toISOString();
  const [books, props, offers, asg, esc] = await Promise.all([
    admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).in("status", ["proposed", "confirmed"]).gt("scheduled_start", now).select("id, kind"),
    admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("status", "proposed").select("id"),
    admin.from("partner_offers").update({ status: "withdrawn", responded_at: now }).eq("job_id", jobId).eq("status", "pending").select("id"),
    admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: `Job cancelled: ${reason.trim()}` } as never).eq("job_id", jobId).eq("active", true).select("id, role"),
    admin.from("esc_notifications").update({ status: "cancelled" }).eq("job_id", jobId).is("sent_at", null).not("status", "in", "(cancelled,withdrawn)").select("id"),
  ]);
  for (const r of [books, props, offers, asg, esc]) if (r.error) throw new Error(`Cancelled, but releasing the job's bookings failed: ${r.error.message}. Open the job and check.`);
  await admin.from("jobs").update({ next_action: null }).eq("id", jobId);
  const released = { bookings: books.data?.length ?? 0, dayOffers: props.data?.length ?? 0, tradeOffers: offers.data?.length ?? 0, trades: asg.data?.length ?? 0, escNotices: esc.data?.length ?? 0 };
  await logEvent(jobId, actorId, "job_cancel_released", `Cancelled: released ${released.bookings} booking(s), ${released.trades} trade(s), ${released.tradeOffers} open offer(s); reminders and texts stop. History kept.`, { ...released, decision: 227 }, { internal: true });
  const tell = opts.tell ?? { owner: false, installer: false };
  if (tell.owner || tell.installer) await logEvent(jobId, actorId, "cancel_notice_requested", `Office ticked ${[tell.owner && "email the owner", tell.installer && "text the installer"].filter(Boolean).join(" and ")} — not sent: the wording is still to be approved (decision 227).`, { tell, wording_approved: CANCEL_HOLD_NOTICE_WORDING_APPROVED }, { internal: true });
  return { ok: true, released, noticesSent: false };
}

/** Decision 227: a cancelled job reopens from Closed with a reason, back to the stage it was at; history kept. */
export async function reopenJob(jobId: string, reason: string, actorId: string) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const { data: job } = await admin.from("jobs").select("stage, prior_stage, job_number").eq("id", jobId).maybeSingle();
  if (!job) throw new WorkflowError("Job not found.");
  const { retiredStageBlocker } = await import("./workflow");
  const blocker = reopenBlocker({ stage: job.stage, priorStage: job.prior_stage, retired: retiredStageBlocker });
  if (blocker) throw new WorkflowError(blocker);
  const { error } = await admin.from("jobs").update({ stage: job.prior_stage!, prior_stage: null, cancelled_reason: null }).eq("id", jobId).eq("stage", "cancelled");
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "stage_changed", `Reopened: ${reason.trim()}`, { reason: reason.trim(), decision: 227 }, { from: "cancelled", to: job.prior_stage! });
  return { ok: true, stage: job.prior_stage };
}

/** Decision 233 Hold dialog: reason, until (optional), tell-them ticks (recorded only), 30-day clock unchanged. */
export async function holdJob(jobId: string, reason: string, actorId: string, opts: { until?: string | null; note?: string | null; tell?: TellTicks } = {}) {
  const full = opts.note?.trim() ? `${reason.trim()} · ${opts.note.trim()}` : reason.trim();
  const { applyHoldOrCancel } = await import("./job-disposition.server");
  await applyHoldOrCancel(jobId, "hold", full, actorId, { decision: 233, reason: reason.trim(), until: opts.until ?? null });
  if (opts.until) { const { error } = await admin.from("jobs").update({ hold_revisit_at: opts.until }).eq("id", jobId); if (error) throw new Error(error.message); }
  const tell = opts.tell ?? { owner: false, installer: false };
  if (tell.owner || tell.installer) await logEvent(jobId, actorId, "hold_notice_requested", `Office ticked ${[tell.owner && "email the owner", tell.installer && "text the installer"].filter(Boolean).join(" and ")} — not sent: the wording is still to be approved.`, { tell, wording_approved: CANCEL_HOLD_NOTICE_WORDING_APPROVED }, { internal: true });
  return { ok: true, noticesSent: false };
}

/** Decision 233 More › Mark as test: the job becomes a TEST record (Closed › Removed / test). */
export async function markJobAsTest(jobId: string, reason: string, actorId: string) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const { error } = await admin.from("jobs").update({ source: "qa_test" }).eq("id", jobId);
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "marked_test", `Marked as test record: ${reason.trim()}`, {}, { internal: true });
  return { ok: true };
}

export type LogWhat = "call" | "note" | "email_received" | "text_received";
export type WaitingWho = "us" | "owner" | "installer" | "electrician" | "nothing";
/** Decision 216/233: Log a call or note — goes into Contact history as recorded by the office (never sent). */
export async function logCallOrNote(jobId: string, actorId: string, i: { what: LogWhat; who: "owner" | "installer" | "electrician"; party: string | null; said: string; waitingFor: WaitingWho }) {
  const { recordCommunication } = await import("./comms.server");
  const channel = i.what === "call" ? "phone" : i.what === "note" ? "note" : i.what === "email_received" ? "email" : "sms";
  const direction = i.what === "email_received" || i.what === "text_received" ? "inbound" : "internal";
  const id = await recordCommunication({ jobId, direction, channel, senderText: direction === "inbound" ? i.party ?? i.who : "Home Insulation Victoria", recipients: [], subject: null, body: i.said.trim(), visibility: i.who === "owner" ? "customer" : "trade", sourceEvent: "office_log", sourceReference: i.who, createdBy: actorId });
  await logEvent(jobId, actorId, "office_waiting_for", `Logged ${i.what.replace("_", " ")} (${i.who}); now waiting for ${i.waitingFor === "us" ? "us" : i.waitingFor === "nothing" ? "nothing" : `the ${i.waitingFor}`}`, { communication_id: id, waiting_for: i.waitingFor, who: i.who }, { internal: true });
  return { id };
}

/** O4 inline fix (decision 216/238): the tidy runs on save; only a complete, valid name + split address is accepted. */
export async function saveFixDetails(jobId: string, actorId: string, v: { fullName: string; street: string; suburb: string; postcode: string }) {
  const errors = fixDetailsErrors(v);
  if (errors.length) throw new WorkflowError(`Still to fix: ${errors.join(", ")}.`);
  const t = tidyEnquiryDetails({ fullName: v.fullName, addressLine: v.street, suburb: v.suburb, postcode: v.postcode });
  const { data: job } = await admin.from("jobs").select("owner_id, property_id, owners(full_name), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
  if (!job) throw new WorkflowError("Job not found.");
  const before = { name: (job.owners as { full_name?: string } | null)?.full_name ?? null, ...(job.properties as Record<string, unknown> | null) };
  const [o, p] = await Promise.all([
    admin.from("owners").update({ full_name: t.fullName }).eq("id", job.owner_id),
    admin.from("properties").update({ address_line: t.street, suburb: t.suburb, postcode: t.postcode, state: "VIC" }).eq("id", job.property_id),
  ]);
  if (o.error || p.error) throw new Error(`Details could not be saved: ${(o.error ?? p.error)!.message}`);
  await logEvent(jobId, actorId, "enquiry_details_fixed", `Details fixed: ${t.fullName} · ${t.street}, ${t.suburb} ${t.postcode}`, { before, after: { name: t.fullName, address_line: t.street, suburb: t.suburb, postcode: t.postcode }, decision: 216 }, { internal: true });
  return { ok: true, fullName: t.fullName, street: t.street, suburb: t.suburb, postcode: t.postcode };
}

async function askEvent(eventId: string, type: string): Promise<AskEvent> {
  const { data, error } = await admin.from("workflow_events").select("id, job_id, event_type, created_at, details").eq("id", eventId).maybeSingle();
  if (error || !data || data.event_type !== type) throw new WorkflowError("That email is no longer on Needs me.");
  const { data: all } = await admin.from("workflow_events").select("id, job_id, event_type, created_at, details").in("event_type", [EMAIL_CHANGE_RESOLVED_EVENT, EMAIL_UNMATCHED_RESOLVED_EVENT]).contains("details", type === EMAIL_CHANGE_REQUEST_EVENT ? { request_event_id: eventId } : { source_event_id: eventId });
  const ev = data as AskEvent;
  const open = openEmailAsks([ev, ...((all ?? []) as AskEvent[])]);
  if (!open.changes.length && !open.unmatched.length) throw new WorkflowError("That email was already dealt with.");
  return ev;
}

/** Decision 245: Apply / Ignore. Only contact details are changed here (the owner's new phone/email, audited); a cancel or
 *  day change is done by the office in the job's own guarded action and then recorded as applied. */
export async function resolveEmailChange(eventId: string, decision: "apply" | "ignore", actorId: string) {
  const ev = await askEvent(eventId, EMAIL_CHANGE_REQUEST_EVENT);
  const row = openEmailAsks([ev]).changes[0]!;
  if (decision === "apply" && row.apply === "update_contact" && row.proposed) {
    const { data: job } = await admin.from("jobs").select("owner_id, owners(phone, email)").eq("id", ev.job_id).maybeSingle();
    if (!job) throw new WorkflowError("Job not found.");
    const { error } = await admin.from("owners").update({ ...(row.proposed.phone ? { phone: row.proposed.phone } : {}), ...(row.proposed.email ? { email: row.proposed.email.toLowerCase() } : {}) }).eq("id", job.owner_id);
    if (error) throw new Error(error.message);
    await logEvent(ev.job_id, actorId, "owner_contact_updated_from_email", "Owner contact details updated from their email (office applied)", { before: job.owners, after: row.proposed, request_event_id: eventId, decision: 245 }, { internal: true });
  }
  await logEvent(ev.job_id, actorId, EMAIL_CHANGE_RESOLVED_EVENT, decision === "apply" ? `Email request applied: ${row.line}` : `Email request ignored: ${row.line}`, { request_event_id: eventId, message_id: (ev.details as { message_id?: string } | null)?.message_id ?? null, decision: decision === "apply" ? "applied" : "ignored" }, { internal: true });
  return { ok: true, apply: row.apply };
}

/** Decision 247: Match this email → filed on the chosen job's Contact history; or Not a customer. */
export async function resolveUnmatchedEmail(eventId: string, decision: "match" | "not_customer", actorId: string, jobId?: string | null) {
  const ev = await askEvent(eventId, EMAIL_UNMATCHED_EVENT);
  const d = (ev.details ?? {}) as { message_id?: string; from?: string; subject?: string; excerpt?: string; received_at?: string };
  if (decision === "match") {
    if (!jobId) throw new WorkflowError("Choose the job this email belongs to.");
    const { data: job } = await admin.from("jobs").select("id").eq("id", jobId).maybeSingle();
    if (!job) throw new WorkflowError("Job not found.");
    const { recordCommunication } = await import("./comms.server");
    await recordCommunication({ jobId, direction: "inbound", channel: "email", senderText: d.from ?? null, subject: d.subject ?? null, body: d.excerpt ?? "(email matched by the office — full text in Outlook)", at: d.received_at ?? null, visibility: "customer", provider: "outlook", sourceEvent: "email_unmatched_matched", sourceReference: d.message_id ?? eventId, createdBy: actorId, deliveryStatus: "received" });
  }
  await logEvent(decision === "match" ? jobId! : ev.job_id, actorId, EMAIL_UNMATCHED_RESOLVED_EVENT, decision === "match" ? `Email from ${d.from ?? "unknown sender"} matched to this job` : `Email from ${d.from ?? "unknown sender"} marked not a customer`, { source_event_id: eventId, message_id: d.message_id ?? null, decision: decision === "match" ? "matched" : "not_customer", job_id: jobId ?? null }, { internal: true });
  return { ok: true };
}
