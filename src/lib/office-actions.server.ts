// Office actions behind the redesigned screens (O2 More menu, O3/O4 Actions, the audited enquiry details save). The O1 email rows use
// the backend's email-office.server (decisions 245/247).
// Every change is audited through workflow_events and uses the existing guarded paths; the only sends are the ticked
// Cancel notices (decision 291), delegated to cancel-notice.server.ts behind the existing guarded senders.
// Server-only; callers (office-screens.functions.ts) have already checked requireAdmin.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { tidyEnquiryDetails } from "./name-address-tidy.core";
import { reopenPlan } from "./office-jobs.core";

/** Owner email / installer notice on Hold (decision 233): the dialog is approved (228) but the HOLD wording is not, so the
 *  ticks are recorded for the office and NOTHING is sent until Jo approves it. Cancel notices are approved (decision 291:
 *  O69 / I70, `cancel-notice.core.ts` CANCEL_NOTICE_EMAILS_APPROVED) and sent by `cancel-notice.server.ts`. */
export const HOLD_NOTICE_WORDING_APPROVED = false;

export type TellTicks = { owner: boolean; installer: boolean };

type InstallerRecipient = import("./cancel-notice.server").InstallerRecipient;

/** Decision 291: who gets I70 — the installer business active on the job (read BEFORE the cancel ends it), else the originating business. */
async function installerRecipientFor(jobId: string, originatingBusinessId: string | null): Promise<InstallerRecipient | null> {
  const { isTestPartner } = await import("./test-send.core");
  type Biz = { name: string | null; trading_name: string | null; email: string | null; onboarding_notes: string | null };
  const { data: asg } = await admin.from("job_assignments").select("business_id, profiles:user_id(full_name, email), businesses(name, trading_name, email, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  if (asg) {
    const biz = (asg.businesses ?? null) as Biz | null;
    const prof = (asg.profiles ?? null) as { full_name: string | null; email: string | null } | null;
    return { businessId: asg.business_id ?? null, contactName: prof?.full_name ?? biz?.trading_name ?? biz?.name ?? null, email: biz?.email ?? prof?.email ?? null, isTestPartner: isTestPartner(biz) };
  }
  if (!originatingBusinessId) return null;
  const { data: biz } = await admin.from("businesses").select("name, trading_name, email, onboarding_notes").eq("id", originatingBusinessId).maybeSingle();
  if (!biz) return null;
  const b = biz as Biz;
  return { businessId: originatingBusinessId, contactName: b.trading_name ?? b.name ?? null, email: b.email ?? null, isTestPartner: isTestPartner(b) };
}

/**
 * Decision 227: Cancel at any time. Reason required; moves the job to Closed; stops reminders and texts (every reminder
 * path skips cancelled jobs, and open ESC notices are cancelled); releases any held install day and the installer
 * (future bookings cancelled, open day offers superseded, pending trade offers withdrawn, active assignments ended);
 * keeps history (nothing deleted). Decision 291: when ticked, the owner gets email O69 and the installer email I70
 * through the guarded senders (`cancel-notice.server.ts`), one event per send, never twice for the same cancellation.
 */
export async function cancelJobFully(jobId: string, reason: string, actorId: string | null, opts: { note?: string | null; tell?: TellTicks; bulk?: boolean } = {}) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const { data: job, error } = await admin.from("jobs").select("stage, job_number, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (error || !job) throw new WorkflowError("Job not found.");
  if (job.stage === "cancelled") throw new WorkflowError(`${job.job_number} is already cancelled.`);
  if (job.stage === "complete") throw new WorkflowError(`${job.job_number} is complete — a completed job cannot be cancelled.`);
  const tell = opts.tell ?? { owner: false, installer: false };
  // Decision 291: the installer to tell is read before the assignment is ended below; the cancel number keys the notices.
  const installerRecipient = tell.installer ? await installerRecipientFor(jobId, (job as { originating_installer_business_id?: string | null }).originating_installer_business_id ?? null) : null;
  const { data: priorCancels } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "job_cancel_released");
  const cancelSeq = priorCancels?.length ?? 0;
  const full = opts.note?.trim() ? `${reason.trim()} · ${opts.note.trim()}` : reason.trim();
  const { applyHoldOrCancel } = await import("./job-disposition.server");
  await applyHoldOrCancel(jobId, "cancel", full, actorId, { decision: 227, reason: reason.trim(), note: opts.note?.trim() || null, ...(opts.bulk ? { bulk: true } : {}) });
  const now = new Date().toISOString();
  const [books, props, offers, asg, esc, holds] = await Promise.all([
    admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).in("status", ["proposed", "confirmed"]).gt("scheduled_start", now).select("id, kind"),
    admin.from("appointment_proposals").update({ status: "superseded" }).eq("job_id", jobId).eq("status", "proposed").select("id"),
    admin.from("partner_offers").update({ status: "withdrawn", responded_at: now }).eq("job_id", jobId).eq("status", "pending").select("id"),
    admin.from("job_assignments").update({ active: false, ended_at: now, end_reason: `Job cancelled: ${reason.trim()}` } as never).eq("job_id", jobId).eq("active", true).select("id, role"),
    admin.from("esc_notifications").update({ status: "cancelled" }).eq("job_id", jobId).is("sent_at", null).not("status", "in", "(cancelled,withdrawn)").select("id"),
    // The expected install week (planning note) stops counting against the installer's capacity.
    admin.from("install_holds").update({ status: "released", released_at: now, release_reason: `Job cancelled: ${reason.trim()}`.slice(0, 480), updated_at: now }).eq("job_id", jobId).eq("status", "active").select("id"),
  ]);
  for (const r of [books, props, offers, asg, esc, holds]) if (r.error) throw new Error(`Cancelled, but releasing the job's bookings failed: ${r.error.message}. Open the job and check.`);
  await admin.from("jobs").update({ next_action: null }).eq("id", jobId);
  const released = { bookings: books.data?.length ?? 0, dayOffers: props.data?.length ?? 0, tradeOffers: offers.data?.length ?? 0, trades: asg.data?.length ?? 0, escNotices: esc.data?.length ?? 0, installHolds: holds.data?.length ?? 0 };
  await logEvent(jobId, actorId, "job_cancel_released", `Cancelled: released ${released.bookings} booking(s), ${released.trades} trade(s), ${released.tradeOffers} open offer(s); reminders and texts stop. History kept.`, { ...released, cancel_seq: cancelSeq, decision: 227 }, { internal: true });
  let notices: import("./cancel-notice.server").CancelNoticeResult = { owner: null, installer: null };
  if (tell.owner || tell.installer) {
    // History: the ticks themselves (decision 227), then one event per send / hold (decision 291).
    const { CANCEL_NOTICE_EMAILS_APPROVED } = await import("./cancel-notice.core");
    await logEvent(jobId, actorId, "cancel_notice_requested", `Office ticked ${[tell.owner && "email the owner", tell.installer && "email the installer"].filter(Boolean).join(" and ")} — sending by email (decision 291).`, { tell, wording_approved: CANCEL_NOTICE_EMAILS_APPROVED, cancel_seq: cancelSeq }, { internal: true });
    try {
      const { sendCancelNotices } = await import("./cancel-notice.server");
      notices = await sendCancelNotices(jobId, actorId ?? "", tell, { cancelSeq, installer: installerRecipient });
    } catch (e) {
      await logEvent(jobId, actorId, "cancel_notice_held", `Cancel notices could not be sent: ${(e as Error).message}`, { tell, cancel_seq: cancelSeq, decision: 291 }, { internal: true }).catch(() => undefined);
    }
  }
  return { ok: true, released, notices, noticesSent: notices.owner?.status === "sent" || notices.installer?.status === "sent" };
}

/** Decision 227 (+ office gaps A4): a closed job reopens with a reason — every closed reason except Completed. Undoes
 *  exactly what closed it (reopenPlan); history kept. The installer / electrician released at cancel is not re-offered. */
export async function reopenJob(jobId: string, reason: string, actorId: string) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const { data: job } = await admin.from("jobs").select("stage, prior_stage, job_number, source, eligibility_outcome").eq("id", jobId).maybeSingle();
  if (!job) throw new WorkflowError("Job not found.");
  const [removed, marked, dup] = await Promise.all([
    admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "lead_removed").limit(1),
    admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", "marked_test").order("created_at", { ascending: false }).limit(1),
    admin.from("office_job_list").select("contact_rank").eq("id", jobId).maybeSingle(),
  ]);
  const testPriorSource = ((marked.data?.[0] as { details?: { prior_source?: unknown } } | undefined)?.details?.prior_source as string | undefined) ?? null;
  const { retiredStageBlocker } = await import("./workflow");
  const plan = reopenPlan({
    stage: job.stage, priorStage: job.prior_stage, eligibilityOutcome: job.eligibility_outcome ?? null, source: job.source ?? null, testPriorSource,
    removedLead: (removed.data?.length ?? 0) > 0, duplicateContact: (dup.data?.contact_rank ?? 1) > 1, retired: retiredStageBlocker,
  });
  if (!plan.ok) throw new WorkflowError(plan.blocker);
  const why = reason.trim();
  if (plan.source) {
    const { error } = await admin.from("jobs").update({ source: plan.source as never }).eq("id", jobId).eq("source", "qa_test");
    if (error) throw new Error(error.message);
    await logEvent(jobId, actorId, "unmarked_test", `Back from test records (source ${plan.source}): ${why}`, { reason: why, source: plan.source, decision: 227 }, { internal: true });
  }
  if (plan.clearIneligible) {
    const { error } = await admin.from("jobs").update({ eligibility_outcome: "needs_onsite_confirmation", eligibility_set_by: actorId, eligibility_set_at: new Date().toISOString(), eligibility_decision_source: "admin", eligibility_review_required: false }).eq("id", jobId);
    if (error) throw new Error(error.message);
    await logEvent(jobId, actorId, "eligibility_set", `Eligibility reopened: needs onsite confirmation (${why})`, { reason: why, previous_outcome: job.eligibility_outcome, decision: 227 }, { internal: true });
  }
  if (plan.stage) {
    const { error } = await admin.from("jobs").update({ stage: plan.stage as never, prior_stage: null, cancelled_reason: null }).eq("id", jobId).eq("stage", "cancelled");
    if (error) throw new Error(error.message);
    await logEvent(jobId, actorId, "stage_changed", `Reopened: ${why}`, { reason: why, decision: 227 }, { from: "cancelled", to: plan.stage as never });
  } else {
    await logEvent(jobId, actorId, "job_reopened", `Reopened: ${why}`, { reason: why, decision: 227 }, { internal: true });
  }
  return { ok: true, stage: plan.stage ?? job.stage };
}

/** Decision 233 Hold dialog: reason, until (optional), tell-them ticks (recorded only), 30-day clock unchanged. */
export async function holdJob(jobId: string, reason: string, actorId: string, opts: { until?: string | null; note?: string | null; tell?: TellTicks } = {}) {
  const full = opts.note?.trim() ? `${reason.trim()} · ${opts.note.trim()}` : reason.trim();
  const { applyHoldOrCancel } = await import("./job-disposition.server");
  await applyHoldOrCancel(jobId, "hold", full, actorId, { decision: 233, reason: reason.trim(), until: opts.until ?? null });
  if (opts.until) { const { error } = await admin.from("jobs").update({ hold_revisit_at: opts.until }).eq("id", jobId); if (error) throw new Error(error.message); }
  const tell = opts.tell ?? { owner: false, installer: false };
  if (tell.owner || tell.installer) await logEvent(jobId, actorId, "hold_notice_requested", `Office ticked ${[tell.owner && "email the owner", tell.installer && "email the installer"].filter(Boolean).join(" and ")} — not sent: the hold wording is still to be approved.`, { tell, wording_approved: HOLD_NOTICE_WORDING_APPROVED }, { internal: true });
  return { ok: true, noticesSent: false };
}

/** Decision 233 More › Mark as test: the job becomes a TEST record (Closed › Removed / test). */
export async function markJobAsTest(jobId: string, reason: string, actorId: string) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const { data: before } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
  const { error } = await admin.from("jobs").update({ source: "qa_test" }).eq("id", jobId);
  if (error) throw new Error(error.message);
  // prior_source lets Reopen put it back (office gaps A4).
  await logEvent(jobId, actorId, "marked_test", `Marked as test record: ${reason.trim()}`, { prior_source: before?.source ?? null }, { internal: true });
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

/**
 * The one audited save for an enquiry's name / street / suburb / postcode (decision 216 tidy on save; decision 281: used
 * by the automatic address completion — the inline form on Enquiries is gone). Nothing is required beyond a street: a
 * first-name-only or odd name is stored tidied, as it is, and is editable on the job page like any other field.
 * `event` lets the completion record its own workflow event type, summary and details.
 */
export async function saveEnquiryDetails(jobId: string, actorId: string | null, v: { fullName: string; street: string; suburb: string; postcode: string },
  event: { type?: string; summary?: string; details?: Record<string, unknown> } = {}) {
  const t = tidyEnquiryDetails({ fullName: v.fullName, addressLine: v.street, suburb: v.suburb, postcode: v.postcode });
  if (!t.street) throw new WorkflowError("A street address is needed.");
  if (t.postcode && !/^[38]\d{3}$/.test(t.postcode)) throw new WorkflowError("The postcode must be a Victorian postcode.");
  const { data: job } = await admin.from("jobs").select("owner_id, property_id, owners(full_name), properties(address_line, suburb, postcode)").eq("id", jobId).maybeSingle();
  if (!job) throw new WorkflowError("Job not found.");
  const before = { name: (job.owners as { full_name?: string } | null)?.full_name ?? null, ...(job.properties as Record<string, unknown> | null) };
  const [o, p] = await Promise.all([
    admin.from("owners").update({ full_name: t.fullName }).eq("id", job.owner_id),
    admin.from("properties").update({ address_line: t.street, suburb: t.suburb || null, postcode: t.postcode || null, state: "VIC" }).eq("id", job.property_id),
  ]);
  if (o.error || p.error) throw new Error(`Details could not be saved: ${(o.error ?? p.error)!.message}`);
  await logEvent(jobId, actorId, event.type ?? "enquiry_details_fixed", event.summary ?? `Details fixed: ${t.fullName} · ${t.street}, ${t.suburb} ${t.postcode}`,
    { before, after: { name: t.fullName, address_line: t.street, suburb: t.suburb, postcode: t.postcode }, decision: 216, ...(event.details ?? {}) }, { internal: true });
  return { ok: true, fullName: t.fullName, street: t.street, suburb: t.suburb, postcode: t.postcode };
}
