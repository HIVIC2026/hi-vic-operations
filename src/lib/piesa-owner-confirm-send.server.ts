// Decision 296: ask the owner to confirm the PIESA by EMAIL (O71) AND TEXT once the electrician has completed it, remind on
// days 1 and 3, alert the office on day 5 (Needs me `piesa_owner_unsigned`). Runs from the 15-minute allocation tick.
// Every step is recorded once as a `piesa_owner_confirm_reminder` workflow event (keyed to the PIESA record) BEFORE anything
// is sent, so a tick never repeats a step and a re-done PIESA gets its own request. Wording is a DRAFT: real owners get
// nothing until PIESA_OWNER_CONFIRM_EMAIL_APPROVED / the `piesa_owner_confirm` SMS type are approved by Jo; TEST jobs use
// test-send. Real delivery still goes through the guarded owner email path (customer_comms_enabled + consent) and the one
// real SMS sender. Reads/sign/gate live in piesa-owner-confirm.server.ts (no senders there).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  PIESA_OWNER_CONFIRM_EMAIL_APPROVED, PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT, PIESA_OWNER_CONFIRM_SMS_TYPE, PIESA_OWNER_CONFIRM_STEP_EVENT, nextPiesaConfirmStep, piesaConfirmKey,
  piesaConfirmPage, piesaConfirmPurpose, piesaOwnerConfirmReminderText, piesaOwnerConfirmRequestText, type PiesaConfirmStep,
} from "./piesa-owner-confirm.core";
import { renderPiesaOwnerConfirmEmail } from "./piesa-owner-confirm-email.core";
import { ownerPiesaConfirmFacts } from "./piesa-owner-confirm.server";

/** Jobs between the PIESA and the booked install day. Nothing after the install is booked (the gate has passed). */
export const PIESA_CONFIRM_ACTIVE_STAGES = ["piesa_complete", "electrical_variation_pending", "awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling"] as const;

async function doneSteps(jobId: string, piesaRecordId: string): Promise<PiesaConfirmStep[]> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", PIESA_OWNER_CONFIRM_STEP_EVENT).contains("details", { piesa_record_id: piesaRecordId });
  return (data ?? []).map((e) => (e.details as { step?: PiesaConfirmStep } | null)?.step).filter((s): s is PiesaConfirmStep => !!s);
}

/** Sends one step (email + text) to the owner. Records the step first; never sends twice for the same step and PIESA. */
export async function sendPiesaConfirmStep(jobId: string, step: PiesaConfirmStep): Promise<string> {
  const facts = await ownerPiesaConfirmFacts(jobId);
  if (!facts) return "no PIESA record";
  if (facts.confirmation) return "already confirmed";
  const recordId = facts.piesaRecordId;
  if (step === "office_alert_5") {
    const { data: dup } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT).contains("details", { piesa_record_id: recordId }).limit(1);
    if ((dup ?? []).length) return "already alerted";
    await logEvent(jobId, null, PIESA_OWNER_CONFIRM_STEP_EVENT, "PIESA owner confirmation: day-5 office alert raised", { step, piesa_record_id: recordId }, { internal: true });
    await logEvent(jobId, null, PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT, "5 days since the electrical safety check and the owner has not confirmed it — the install can't be booked. Needs Home Insulation Victoria", { step, piesa_record_id: recordId, completed_date: facts.completedDate });
    return "office alerted";
  }
  if ((await doneSteps(jobId, recordId)).includes(step)) return "already handled";
  // Task 5: one combined signed-copy/declaration email owns the request. No separate O71 email or text.
  if (step === 'request' || step === 'reminder_1' || step === 'reminder_3') {
    const result = await (await import('./piesa-delivery.server')).deliverPiesaCopies(jobId);
    const { data: delivered, error } = await admin.from('piesa_deliveries').select('id').eq('job_id',jobId).eq('piesa_record_id',recordId).eq('recipient','owner').limit(1);
    if (error) throw new Error('Could not confirm owner PIESA copy delivery');
    if (result.sent.includes('owner') || delivered?.length) await logEvent(jobId,null,PIESA_OWNER_CONFIRM_STEP_EVENT,'Combined PIESA copy and owner declaration email delivered',{step,piesa_record_id:recordId},{internal:true});
    return result.sent.includes('owner') ? 'email sent' : result.hold ?? result.held['owner'] ?? 'already delivered';
  }
  if ((await doneSteps(jobId, recordId)).includes(step)) return "already handled";
  const request = step === "request";
  await logEvent(jobId, null, PIESA_OWNER_CONFIRM_STEP_EVENT, request ? "PIESA owner confirmation request prepared for the owner (email O71 + text)" : `PIESA owner confirmation reminder (${step}) prepared for the owner (email O71 + text)`, { step, piesa_record_id: recordId }, { internal: true });
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: asg }, link] = await Promise.all([
    admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(jobId),
  ]);
  if (!link) { await logEvent(jobId, null, "piesa_owner_confirm_not_sent", "No working owner job link, so the owner could not be asked to confirm the electrical safety check", { step, piesa_record_id: recordId }, { internal: true }); return "not sent — owner link missing"; }
  const { firstName } = await import("./worker-links.core");
  const page = piesaConfirmPage(facts);
  const smsBody = request ? piesaOwnerConfirmRequestText(link) : piesaOwnerConfirmReminderText(link);
  const key = piesaConfirmKey(jobId, recordId, step);
  const build = (unsubscribeUrl: string | null, test: boolean) => renderPiesaOwnerConfirmEmail({ firstName: firstName(owner?.full_name ?? null), assessmentDate: page.assessmentDate, electricianLine: page.electricianLine, outcomeKind: page.outcomeKind, confirmUrl: link, unsubscribeUrl, reminder: !request, test });
  const out: string[] = [];
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `piesa_owner_confirm:${step}`, actorId: null };
    const mail = build(null, true);
    const email = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    out.push(`email ${email.status}: ${email.detail}`);
    const sms = await sendTestSms(ctx, owner?.phone ?? "", smsBody);
    out.push(`sms ${sms.status}: ${sms.detail}`);
    return out.join("; ");
  }
  if (!PIESA_OWNER_CONFIRM_EMAIL_APPROVED) out.push("email not sent — wording awaiting approval");
  else if (!owner?.email) out.push("email not sent — no owner email");
  else {
    const { assertCustomerDeliveryAllowed } = await import("./comms.server");
    try {
      await assertCustomerDeliveryAllowed(jobId, "PIESA owner confirmation email");
      out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: piesaConfirmPurpose(step), key, build: (u) => build(u, false) })}`);
    } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
  }
  // The one real text sender: switch, approval, quiet hours, consent and STOP all live there; a held text is recorded, never sent.
  // `window` type: this step is recorded above before any send, so a switch flip never re-fires an old step.
  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({ type: PIESA_OWNER_CONFIRM_SMS_TYPE, idempotencyKey: key, to: owner?.phone ?? null, body: smsBody, jobId });
  out.push(`sms ${s.status}: ${s.detail}`);
  return out.join("; ");
}

/** 15-minute tick: one due step per unconfirmed PIESA on jobs that have not booked the install yet. */
/** Perf 25 Oct 2026: the facts the step decision needs (latest owner-confirmed-kind PIESA record, its confirmation and
 *  the steps already recorded) read for EVERY candidate job at once, instead of ownerPiesaConfirmFacts (≈8 reads) +
 *  doneSteps per job per tick. Same rule (nextPiesaConfirmStep); the send path re-reads everything itself. */
export async function duePiesaConfirmSteps(jobIds: string[], now: Date): Promise<Map<string, PiesaConfirmStep>> {
  const due = new Map<string, PiesaConfirmStep>();
  if (!jobIds.length) return due;
  const { readByJobIds } = await import("./sweep-batch.server");
  const { groupByJob, latestPerJob, stepsForRecord } = await import("./sweep-batch.core");
  const { OWNER_CONFIRMED_PIESA_KINDS } = await import("./piesa-owner-confirm.server");
  const { PIESA_OWNER_CONFIRMED_EVENT, confirmationFromEvents } = await import("./piesa-owner-confirm.core");
  type Rec = { id: string; job_id: string | null; created_at: string; signed_off_by: string | null };
  type Ev = { job_id: string | null; details: unknown; created_at: string };
  const [recs, confirms, steps] = await Promise.all([
    readByJobIds<Rec>("PIESA records", jobIds, (c) => admin.from("piesa_records").select("id, job_id, created_at, signed_off_by").in("job_id", c).in("kind", [...OWNER_CONFIRMED_PIESA_KINDS])),
    readByJobIds<Ev>("PIESA owner confirmations", jobIds, (c) => admin.from("workflow_events").select("job_id, details, created_at").in("job_id", c).eq("event_type", PIESA_OWNER_CONFIRMED_EVENT)),
    readByJobIds<Ev>("PIESA confirmation steps", jobIds, (c) => admin.from("workflow_events").select("job_id, details, created_at").in("job_id", c).eq("event_type", PIESA_OWNER_CONFIRM_STEP_EVENT)),
  ]);
  const latest = latestPerJob(recs), confirmsBy = groupByJob(confirms), stepsBy = groupByJob(steps);
  for (const id of jobIds) {
    const rec = latest.get(id);
    if (!rec || !rec.signed_off_by) continue; // ownerPiesaConfirmFacts → null
    const confirmation = confirmationFromEvents(confirmsBy.get(id) ?? [], rec.id);
    const step = nextPiesaConfirmStep({ completedAt: rec.created_at, confirmedAt: confirmation?.signedAt ?? null, done: stepsForRecord<PiesaConfirmStep>(stepsBy.get(id) ?? [], rec.id), now: now.toISOString() });
    if (step) due.set(id, step);
  }
  return due;
}

export async function sweepOwnerPiesaConfirmations(now = new Date()): Promise<{ checked: number; sent: number; alerts: number }> {
  const { data: jobs, error } = await admin.from("jobs").select("id").in("stage", [...PIESA_CONFIRM_ACTIVE_STAGES]).is("deleted_at", null);
  if (error) throw new Error(`Could not read PIESA confirmation jobs: ${error.message}`);
  const ids = (jobs ?? []).map((j) => j.id);
  const due = await duePiesaConfirmSteps(ids, now);
  let sent = 0, alerts = 0;
  for (const id of ids) {
    const step = due.get(id);
    if (!step) continue;
    const j = { id };
    try {
      const outcome = await sendPiesaConfirmStep(j.id, step);
      if (outcome === "office alerted") alerts++; else if (outcome === 'email sent') sent++;
    } catch (e) { console.error("PIESA owner confirmation step failed", j.id, (e as Error).message); }
  }
  return { checked: (jobs ?? []).length, sent, alerts };
}
