// Decision 330: ask the owner to confirm the ELECTRICAL FIXES (email O72 + text) once the A4 fixes form is complete
// (completeFixesForm calls `sendFixesConfirmStep(jobId, "request")` right after the post_rectification record), remind on
// days 1 and 3, raise the office row on day 5 — the same schedule, guards and senders as the decision-296 O71 path
// (piesa-owner-confirm-send.server). Every step is recorded once as a `piesa_owner_fixes_confirm_reminder` event (keyed to the
// post_rectification record) BEFORE anything is sent. TEST jobs → test-send; real owners through the guarded owner email
// path (customer_comms_enabled + consent) and the one real SMS sender. Never a booking gate.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { nextPiesaConfirmStep, type PiesaConfirmStep } from "./piesa-owner-confirm.core";
import {
  PIESA_FIXES_CONFIRM_EMAIL_APPROVED, PIESA_FIXES_CONFIRM_OFFICE_ALERT_EVENT, PIESA_FIXES_CONFIRM_SMS_TYPE, PIESA_FIXES_CONFIRM_STEP_EVENT,
  piesaFixesConfirmKey, piesaFixesConfirmPage, piesaFixesConfirmPurpose, piesaFixesConfirmText,
} from "./piesa-fixes-confirm.core";
import { renderPiesaFixesConfirmEmail } from "./piesa-fixes-confirm-email.core";
import { ownerFixesConfirmFacts } from "./piesa-fixes-confirm.server";

/** Jobs after the fixes and before the install is finished (the declaration still matters for the official PIESA). */
export const FIXES_CONFIRM_ACTIVE_STAGES = ["rectification_booked", "evidence_outstanding", "installation_scheduling", "installation_booked", "awaiting_deposit_payment", "piesa_complete"] as const;

async function doneSteps(jobId: string, recordId: string): Promise<PiesaConfirmStep[]> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", PIESA_FIXES_CONFIRM_STEP_EVENT).contains("details", { piesa_record_id: recordId });
  return (data ?? []).map((e) => (e.details as { step?: PiesaConfirmStep } | null)?.step).filter((s): s is PiesaConfirmStep => !!s);
}

/** Sends one step (email + text). Records the step first; never twice for the same step and fixes record. Never throws to callers that catch. */
export async function sendFixesConfirmStep(jobId: string, step: PiesaConfirmStep): Promise<string> {
  const facts = await ownerFixesConfirmFacts(jobId);
  if (!facts) return "no fixes record";
  if (facts.confirmation) return "already confirmed";
  const recordId = facts.recordId;
  if (step === "office_alert_5") {
    const { data: dup } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", PIESA_FIXES_CONFIRM_OFFICE_ALERT_EVENT).contains("details", { piesa_record_id: recordId }).limit(1);
    if ((dup ?? []).length) return "already alerted";
    await logEvent(jobId, null, PIESA_FIXES_CONFIRM_STEP_EVENT, "Electrical fixes owner confirmation: day-5 office alert raised", { step, piesa_record_id: recordId }, { internal: true });
    await logEvent(jobId, null, PIESA_FIXES_CONFIRM_OFFICE_ALERT_EVENT, "5 days since the electrical fixes and the owner has not confirmed them — the official PIESA owner declaration stays unticked. Needs Home Insulation Victoria", { step, piesa_record_id: recordId, fixes_date: facts.fixesDate });
    return "office alerted";
  }
  if ((await doneSteps(jobId, recordId)).includes(step)) return "already handled";
  await logEvent(jobId, null, PIESA_FIXES_CONFIRM_STEP_EVENT, `Electrical fixes owner confirmation ${step === "request" ? "request" : `reminder (${step})`} prepared for the owner (email O72 + text)`, { step, piesa_record_id: recordId }, { internal: true });
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: asg }, link] = await Promise.all([
    admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(jobId),
  ]);
  if (!link) { await logEvent(jobId, null, "piesa_owner_fixes_confirm_not_sent", "No working owner job link, so the owner could not be asked to confirm the electrical fixes", { step, piesa_record_id: recordId }, { internal: true }); return "not sent — owner link missing"; }
  const { firstName } = await import("./worker-links.core");
  const page = piesaFixesConfirmPage(facts);
  const smsBody = piesaFixesConfirmText(link);
  const key = piesaFixesConfirmKey(jobId, recordId, step);
  const build = (unsubscribeUrl: string | null, test: boolean) => renderPiesaFixesConfirmEmail({ firstName: firstName(owner?.full_name ?? null), fixesDate: page.fixesDate, electricianLine: page.electricianLine, confirmUrl: link, unsubscribeUrl, test });
  const out: string[] = [];
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `piesa_owner_fixes_confirm:${step}`, actorId: null };
    const mail = build(null, true);
    const email = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    out.push(`email ${email.status}: ${email.detail}`);
    const sms = await sendTestSms(ctx, owner?.phone ?? "", smsBody);
    out.push(`sms ${sms.status}: ${sms.detail}`);
    return out.join("; ");
  }
  if (!PIESA_FIXES_CONFIRM_EMAIL_APPROVED) out.push("email not sent — wording awaiting approval");
  else if (!owner?.email) out.push("email not sent — no owner email");
  else {
    const { assertCustomerDeliveryAllowed } = await import("./comms.server");
    try {
      await assertCustomerDeliveryAllowed(jobId, "Electrical fixes owner confirmation email");
      out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: piesaFixesConfirmPurpose(step), key, build: (u) => build(u, false) })}`);
    } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
  }
  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({ type: PIESA_FIXES_CONFIRM_SMS_TYPE, idempotencyKey: key, to: owner?.phone ?? null, body: smsBody, jobId });
  out.push(`sms ${s.status}: ${s.detail}`);
  return out.join("; ");
}

/** 15-minute tick: one due step per unconfirmed fixes record. */
/** Perf 25 Oct 2026: the step decision's facts (latest post_rectification record, its confirmation, recorded steps) for
 *  EVERY candidate job at once instead of ownerFixesConfirmFacts + doneSteps per job per tick. Same rule; the send path
 *  re-reads everything itself. */
export async function dueFixesConfirmSteps(jobIds: string[], now: Date): Promise<Map<string, PiesaConfirmStep>> {
  const due = new Map<string, PiesaConfirmStep>();
  if (!jobIds.length) return due;
  const { readByJobIds } = await import("./sweep-batch.server");
  const { groupByJob, latestPerJob, stepsForRecord } = await import("./sweep-batch.core");
  const { PIESA_FIXES_CONFIRMED_EVENT, fixesConfirmationFromEvents } = await import("./piesa-fixes-confirm.core");
  type Rec = { id: string; job_id: string | null; created_at: string; completed_date: string | null };
  type Ev = { job_id: string | null; details: unknown; created_at: string };
  const [recs, confirms, steps] = await Promise.all([
    readByJobIds<Rec>("fixes records", jobIds, (c) => admin.from("piesa_records").select("id, job_id, created_at, completed_date").in("job_id", c).eq("kind", "post_rectification")),
    readByJobIds<Ev>("fixes owner confirmations", jobIds, (c) => admin.from("workflow_events").select("job_id, details, created_at").in("job_id", c).eq("event_type", PIESA_FIXES_CONFIRMED_EVENT)),
    readByJobIds<Ev>("fixes confirmation steps", jobIds, (c) => admin.from("workflow_events").select("job_id, details, created_at").in("job_id", c).eq("event_type", PIESA_FIXES_CONFIRM_STEP_EVENT)),
  ]);
  const latest = latestPerJob(recs), confirmsBy = groupByJob(confirms), stepsBy = groupByJob(steps);
  for (const id of jobIds) {
    const rec = latest.get(id);
    if (!rec || !rec.completed_date) continue; // ownerFixesConfirmFacts → null
    const confirmation = fixesConfirmationFromEvents(confirmsBy.get(id) ?? [], rec.id);
    const step = nextPiesaConfirmStep({ completedAt: rec.created_at, confirmedAt: confirmation?.signedAt ?? null, done: stepsForRecord<PiesaConfirmStep>(stepsBy.get(id) ?? [], rec.id), now: now.toISOString() });
    if (step) due.set(id, step);
  }
  return due;
}

export async function sweepOwnerFixesConfirmations(now = new Date()): Promise<{ checked: number; sent: number; alerts: number }> {
  const { data: jobs, error } = await admin.from("jobs").select("id").in("stage", [...FIXES_CONFIRM_ACTIVE_STAGES]).is("deleted_at", null);
  if (error) throw new Error(`Could not read fixes confirmation jobs: ${error.message}`);
  const ids = (jobs ?? []).map((j) => j.id);
  const due = await dueFixesConfirmSteps(ids, now);
  let sent = 0, alerts = 0;
  for (const id of ids) {
    const step = due.get(id);
    if (!step) continue;
    const j = { id };
    try {
      await sendFixesConfirmStep(j.id, step);
      if (step === "office_alert_5") alerts++; else sent++;
    } catch (e) { console.error("Electrical fixes owner confirmation step failed", j.id, (e as Error).message); }
  }
  return { checked: (jobs ?? []).length, sent, alerts };
}
