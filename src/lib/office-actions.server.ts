// Office actions behind the redesigned screens (O2 More menu, O3/O4 Actions, the audited enquiry details save). The O1 email rows use
// the backend's email-office.server (decisions 245/247).
// Every change is audited through workflow_events and uses the existing guarded paths; the only sends are the ticked
// Cancel notices (decision 291), delegated to cancel-notice.server.ts behind the existing guarded senders.
// Server-only; callers (office-screens.functions.ts) have already checked requireAdmin.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { tidyEnquiryDetails } from "./name-address-tidy.core";
import { reopenPlan, reopenStageFor } from "./office-jobs.core";

/** Owner email / installer notice on Hold (decision 233): the dialog is approved (228) but the HOLD wording is not, so the
 *  ticks are recorded for the office and NOTHING is sent until Jo approves it. Cancel notices are approved (decision 291:
 *  O69 / I70, `cancel-notice.core.ts` CANCEL_NOTICE_EMAILS_APPROVED) and sent by `cancel-notice.server.ts`. */
export const HOLD_NOTICE_WORDING_APPROVED = false;

export type TellTicks = { owner: boolean; installer: boolean };

type InstallerRecipient = import("./cancel-notice.server").InstallerRecipient;

/** Decision 291: who gets I70 — the installer business active on the job (read BEFORE the cancel ends it); else (batch 2 F2:
 *  a retry after a failed first try already ended it) the installer most recently released by a cancel since the last
 *  recorded release (`endedSince`); else the originating business. */
async function installerRecipientFor(jobId: string, originatingBusinessId: string | null, endedSince: string | null): Promise<InstallerRecipient | null> {
  const { isTestPartner } = await import("./test-send.core");
  type Biz = { name: string | null; trading_name: string | null; email: string | null; onboarding_notes: string | null };
  const COLS = "business_id, profiles:user_id(full_name, email), businesses(name, trading_name, email, onboarding_notes)";
  let { data: asg } = await admin.from("job_assignments").select(COLS).eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  if (!asg) {
    let ended = admin.from("job_assignments").select(COLS).eq("job_id", jobId).eq("role", "installer").eq("active", false).like("end_reason", "Job cancelled%");
    if (endedSince) ended = ended.gt("ended_at", endedSince);
    ({ data: asg } = await ended.order("ended_at", { ascending: false }).limit(1).maybeSingle());
  }
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
export async function cancelJobFully(jobId: string, reason: string, actorId: string | null, opts: { note?: string | null; tell?: TellTicks; bulk?: boolean; suppressRunNotice?: boolean } = {}) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const { data: job, error } = await admin.from("jobs").select("stage, job_number, originating_installer_business_id").eq("id", jobId).maybeSingle();
  if (error || !job) throw new WorkflowError("Job not found.");
  if (job.stage === "cancelled") throw new WorkflowError(`${job.job_number} is already cancelled.`);
  if (job.stage === "complete") throw new WorkflowError(`${job.job_number} is complete — a completed job cannot be cancelled.`);
  const tell = opts.tell ?? { owner: false, installer: false };
  const full = opts.note?.trim() ? `${reason.trim()} · ${opts.note.trim()}` : reason.trim();
  const { applyHoldOrCancel } = await import("./job-disposition.server");
  await applyHoldOrCancel(jobId, "cancel", full, actorId, { decision: 227, reason: reason.trim(), note: opts.note?.trim() || null, ...(opts.bulk ? { bulk: true } : {}) });
  return releaseCancelledJob(jobId, reason, actorId, tell, {suppressRunNotice:opts.suppressRunNotice});
}

/**
 * The release half of `cancelJobFully`, on its own so it can be run again (batch 2: a STOP cancel whose release failed is
 * retried on the 15-minute tick). Releases bookings, day offers, trade offers, assignments, ESC notices and install holds
 * (each update only touches rows still open, so a repeat is harmless), writes `job_cancel_released`, then sends the
 * ticked cancel notices through their existing once-only keys (same cancel number on a retry).
 */
export async function releaseCancelledJob(jobId: string, reason: string, actorId: string | null, tell: TellTicks, opts:{suppressRunNotice?:boolean}={}) {
  const { data: job } = await admin.from("jobs").select("originating_installer_business_id").eq("id", jobId).maybeSingle();
  const { data: priorCancels } = await admin.from("workflow_events").select("id, created_at").eq("job_id", jobId).eq("event_type", "job_cancel_released");
  const cancelSeq = priorCancels?.length ?? 0;
  const lastReleasedAt = (priorCancels ?? []).map((e) => (e as { created_at?: string | null }).created_at ?? "").filter(Boolean).sort().at(-1) ?? null;
  const installerRecipient = tell.installer ? await installerRecipientFor(jobId, (job as { originating_installer_business_id?: string | null } | null)?.originating_installer_business_id ?? null, lastReleasedAt) : null;
  // Before assignments end: the held lookup still positively identifies this partner.
  await (await import("./in-house-forms.server")).closeUnneededForms(jobId, "cancelled", actorId).catch(async e=>{
    console.error("Unused in-house form closure failed", e instanceof Error ? e.message : "Form read failed");
    await logEvent(jobId, actorId, "in_house_form_close_failed", "Unused forms need office attention", { reason: e instanceof Error ? e.message : "Form closure failed", needs_office: true }, { internal: true });
  });
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
  // A48 batch 2 Task 8 fix round 1: every cancel (office, email, quick taps, quote expiry, My job) of a home with a CONFIRMED
  // window in an installer's run runs the same hook — the installer is told once and can fill the time. Best-effort.
  try { await (await import("./installer-run.server")).runOwnerCancelled(jobId,{silent:opts.suppressRunNotice}); } catch (e) { console.error("run cancel hook skipped", (e as Error).message); }
  let notices: import("./cancel-notice.server").CancelNoticeResult = { owner: null, installer: null };
  if (tell.owner || tell.installer) {
    // History: the ticks themselves (decision 227), then one event per send / hold (decision 291).
    const { CANCEL_NOTICE_EMAILS_APPROVED } = await import("./cancel-notice.core");
    await logEvent(jobId, actorId, "cancel_notice_requested", `Office ticked ${[tell.owner && "email the owner", tell.installer && "email the installer"].filter(Boolean).join(" and ")} — sending by email (decision 291).`, { tell, wording_approved: CANCEL_NOTICE_EMAILS_APPROVED, cancel_seq: cancelSeq }, { internal: true });
    try {
      const { sendCancelNotices } = await import("./cancel-notice.server");
      notices = await sendCancelNotices(jobId, actorId, tell, { cancelSeq, installer: installerRecipient });
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
  // Batch 1 task 6 (Jo 28 Oct 2026): a cancelled stage reopens to a SAFE stage (reopenStageFor), checked like any stage
  // move before anything is written.
  const target = plan.stage ? reopenStageFor(plan.stage) : null;
  if (target) {
    const { stageEntryBlockers } = await import("./workflow.server");
    let blockers = await stageEntryBlockers(jobId, target.stage as never, actorId);
    if (target.needsNewPiesa && blockers.length) {
      // The open repeat-check step (owner accept / pay) is what a reopen sets up; it still gates booking the PIESA.
      const [{ repeatPiesaGateBlocker }, { repeatPiesaContext }] = await Promise.all([import("./repeat-piesa.core"), import("./repeat-piesa.server")]);
      const repeat = repeatPiesaGateBlocker((await repeatPiesaContext(jobId)).state);
      if (repeat) blockers = blockers.filter((b) => b !== repeat);
    }
    if (blockers.length) throw new WorkflowError(blockers[0]!);
  }
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
  if (target) {
    const { data: moved, error } = await admin.from("jobs").update({ stage: target.stage as never, prior_stage: null, cancelled_reason: null }).eq("id", jobId).eq("stage", "cancelled").select("id");
    if (error) throw new Error(error.message);
    // Someone else changed the job meanwhile: stop before anything is released or logged.
    if ((moved?.length ?? 0) !== 1) throw new WorkflowError(`${job.job_number} changed while reopening — refresh and try again.`);
    const released = await releaseStaleTradeOnReopen(jobId, target.stage);
    await logEvent(jobId, actorId, "stage_changed", `Reopened: ${why}`, { reason: why, decision: 227, prior_stage: plan.stage, released }, { from: "cancelled", to: target.stage as never });
    if (target.needsNewPiesa) await supersedePiesaOnReopen(jobId, actorId);
    if (target.stage === "piesa_and_install_window_pending") {
      // Same as transition() into this stage: the expected install week (planning note) is placed again — cancel released it.
      const { createInstallHold } = await import("./install-holds.server");
      await createInstallHold(jobId, actorId).catch((e) => console.error("install hold not placed", (e as Error).message));
    }
  } else {
    await logEvent(jobId, actorId, "job_reopened", `Reopened: ${why}`, { reason: why, decision: 227 }, { internal: true });
  }
  return { ok: true, stage: target?.stage ?? job.stage };
}

/** Batch 1 final fix F3: cancel keeps history (only pending offers and future bookings are released), so a reopened job
 *  still carries the old trade's ACCEPTED offer and any past still-confirmed visit — which hide "Choose installer" /
 *  "choose electrician", block the automatic PIESA offers and make the times screen say "booked". For the trade the
 *  reopened stage needs again (installer for the Ready Check, electrician for the PIESA), accepted offers are withdrawn
 *  ("job reopened") and confirmed/proposed visits of that kind cancelled, whatever their date. Completed visits stay
 *  (electrician pay reads them). */
const REOPEN_RELEASE: Record<string, { offerKinds: string[]; bookingKinds: string[] }> = {
  ready_check_ready_to_schedule: { offerKinds: ["ready_check"], bookingKinds: ["ready_check"] },
  piesa_and_install_window_pending: { offerKinds: ["piesa", "rectification"], bookingKinds: ["assessment"] },
};
async function releaseStaleTradeOnReopen(jobId: string, stage: string): Promise<{ tradeOffers: number; bookings: number }> {
  const r = REOPEN_RELEASE[stage];
  if (!r) return { tradeOffers: 0, bookings: 0 };
  const now = new Date().toISOString();
  if (r.bookingKinds.includes("assessment")) {
    // Re-review: a finished safety check may still be stored as "confirmed" (older moves to PIESA complete never marked
    // it). If the visit is in the past and the job has a finished check (A3 complete or a PIESA record), it is DONE:
    // mark it completed (the old electrician's pay reads it), never cancel it. Only future / undone visits are cancelled.
    const [{ data: a3 }, { data: rec }] = await Promise.all([
      admin.from("assessments").select("id").eq("job_id", jobId).eq("mitti_completed", true).limit(1).maybeSingle(),
      admin.from("piesa_records").select("id").eq("job_id", jobId).limit(1).maybeSingle(),
    ]);
    if (a3 || rec) {
      const { error } = await admin.from("bookings").update({ status: "completed" }).eq("job_id", jobId).eq("kind", "assessment").eq("status", "confirmed").lt("scheduled_start", now);
      if (error) throw new Error(`Reopened, but marking the finished safety check done failed: ${error.message}. Open the job and check.`);
    }
  }
  const [offers, books] = await Promise.all([
    admin.from("partner_offers").update({ status: "withdrawn", decline_reason: "job reopened", superseded_at: now }).eq("job_id", jobId).eq("status", "accepted").in("kind", r.offerKinds).select("id"),
    admin.from("bookings").update({ status: "cancelled" }).eq("job_id", jobId).in("status", ["proposed", "confirmed"]).in("kind", r.bookingKinds as never).select("id"),
  ]);
  for (const x of [offers, books]) if (x.error) throw new Error(`Reopened, but releasing the old trade failed: ${x.error.message}. Open the job and check.`);
  return { tradeOffers: offers.data?.length ?? 0, bookings: books.data?.length ?? 0 };
}

/** Batch 1 task 6 (Jo 28 Oct 2026): reopened at or after the safety check → the old check no longer counts. When a check
 *  was actually done (a PIESA record exists) the owner pays for the new one at the accepted quote's PIESA line; payments
 *  already made stay counted. No record = their original payment covers it. The existing repeat-PIESA gate, owner Accept
 *  and payment then run unchanged (repeat-piesa.server, keyed by the reopen key).
 *  Batch 1 F6 (Jo 29 Oct 2026): if the owner already paid a repeat check that wasn't done, it carries over to the new
 *  check (no new charge, no new Xero line) unless that payment was refunded/reversed (`reopenRepeatDecision`). */
async function supersedePiesaOnReopen(jobId: string, actorId: string) {
  const { REPEAT_REOPEN_EVENT, REPEAT_PIESA_CHOSEN_EVENT, REPEAT_PIESA_PAID_EVENT, reopenKey, reopenRepeatDecision } = await import("./repeat-piesa.core");
  const rps = await import("./repeat-piesa.server");
  // Only a check done since the last reopen counts: an already-superseded check is never charged twice.
  const since = await rps.latestReopenAt(jobId);
  let recQ = admin.from("piesa_records").select("id").eq("job_id", jobId);
  if (since) recQ = recQ.gt("created_at", since);
  const { data: rec } = await recQ.limit(1).maybeSingle();
  const hadCheck = !!rec;
  // The repeat state just before this reopen: a paid repeat that wasn't done yet, and whether it was refunded since.
  const { state: prior } = await rps.repeatPiesaContext(jobId);
  let paidAt: string | null = null, recordAfterPaid = false, reversedCentsSincePaid = 0;
  if (prior.payer === "owner" && prior.stage === "offer" && prior.deadline) {
    const { data: paid } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", REPEAT_PIESA_PAID_EVENT).contains("details", { deadline: prior.deadline }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    paidAt = (paid as { created_at?: string } | null)?.created_at ?? null;
    if (paidAt) {
      const [{ data: after }, { data: rev }] = await Promise.all([
        admin.from("piesa_records").select("id").eq("job_id", jobId).gt("created_at", paidAt).limit(1).maybeSingle(),
        admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "owner_payment_reversed").gte("created_at", paidAt),
      ]);
      recordAfterPaid = !!after;
      // Batch 3b (`reopen refund install only`): a refund on the electrical fixes invoice is never "the safety check was
      // refunded". Reversals on the installation invoice and on the repeat safety check's own invoice still count.
      const revs = (rev ?? []) as { details: { amount_cents?: number; invoice_id?: string } | null }[];
      const revInvoiceIds = [...new Set(revs.map((r) => r.details?.invoice_id).filter((x): x is string => !!x))];
      const { data: fixesInvs } = revInvoiceIds.length ? await admin.from("invoices").select("id").in("id", revInvoiceIds).eq("kind", "rectification") : { data: [] as { id: string }[] };
      const fixesIds = new Set(((fixesInvs ?? []) as { id: string }[]).map((x) => x.id));
      reversedCentsSincePaid = revs.filter((r) => !fixesIds.has(r.details?.invoice_id ?? "")).reduce((a, r) => a + Math.max(0, Math.round(Number(r.details?.amount_cents ?? 0))), 0);
    }
  }
  const decision = reopenRepeatDecision({ hadCheck, prior, paidAt, recordAfterPaid, reversedCentsSincePaid });
  const key = reopenKey(new Date().toISOString());
  if (decision === "carry_over") {
    // Not a new lapse (had_check false): the paid repeat's own deadline stays the current repeat step. The old check
    // still no longer counts (any reopen supersedes it).
    await logEvent(jobId, actorId, REPEAT_REOPEN_EVENT, "Reopened: the earlier safety check (PIESA) no longer counts — the repeat check the owner already paid for covers the new one", { key, had_check: false, check_done: hadCheck, carried_repeat: prior.deadline }, { internal: true });
    return;
  }
  const charge = decision === "charge";
  await logEvent(jobId, actorId, REPEAT_REOPEN_EVENT, charge ? "Reopened: the earlier safety check (PIESA) no longer counts — a new one is needed" : "Reopened: no safety check (PIESA) was done yet — the original payment covers it", { key, had_check: charge }, { internal: true });
  if (!charge) return;
  const { currentApprovedQuote } = await import("./workflow.server");
  const quote = await currentApprovedQuote(jobId);
  const price = (await (await import("./safety-check-amount.server")).quoteSafetyCheck(quote?.id ?? null)).incGst;
  await logEvent(jobId, actorId, REPEAT_PIESA_CHOSEN_EVENT, "Job reopened: the owner pays for the new safety check (PIESA)", {
    deadline: key, payer: "owner", price_inc_gst: price, suggestion: null, installer_payout_deduction_inc_gst: null, reason: "reopen",
  }, { internal: true });
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

/** "Clear" on the Email bounced tag: one internal event (append-only); the tag compares its time with the newest bounce. */
export async function clearEmailBounce(jobId: string, actorId: string) {
  const { emailBouncedSet } = await import("./office-lists.server");
  if (!(await emailBouncedSet([jobId])).has(jobId)) return { cleared: false };
  const { EMAIL_BOUNCE_CLEARED_EVENT } = await import("./email-delivery.core");
  await logEvent(jobId, actorId, EMAIL_BOUNCE_CLEARED_EVENT, "Office cleared the Email bounced tag", {}, { internal: true });
  return { cleared: true };
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
