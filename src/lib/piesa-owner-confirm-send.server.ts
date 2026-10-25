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
export async function sweepOwnerPiesaConfirmations(now = new Date()): Promise<{ checked: number; sent: number; alerts: number }> {
  const { data: jobs } = await admin.from("jobs").select("id").in("stage", [...PIESA_CONFIRM_ACTIVE_STAGES]).is("deleted_at", null);
  let sent = 0, alerts = 0;
  for (const j of jobs ?? []) {
    try {
      const f = await ownerPiesaConfirmFacts(j.id);
      if (!f) continue;
      const step = nextPiesaConfirmStep({ completedAt: f.completedAt, confirmedAt: f.confirmation?.signedAt ?? null, done: await doneSteps(j.id, f.piesaRecordId), now: now.toISOString() });
      if (!step) continue;
      await sendPiesaConfirmStep(j.id, step);
      if (step === "office_alert_5") alerts++; else sent++;
    } catch (e) { console.error("PIESA owner confirmation step failed", j.id, (e as Error).message); }
  }
  return { checked: (jobs ?? []).length, sent, alerts };
}
