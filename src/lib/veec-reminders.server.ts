// Decision 120 (Jo, 24 Oct 2026): ask the owner to sign the VEEC assignment form by EMAIL AND TEXT when the install is
// recorded complete, remind on days 1, 3 and 7, and alert the office on day 10. Pure schedule + wording in
// veec-assignment-form.core.ts. Every step is recorded once as a `veec_sign_reminder` workflow event before anything is
// sent, so a 15-minute tick never repeats a step. TEST jobs use test-send; real owners get email only once
// VEEC_SIGN_EMAIL_APPROVED and texts only through the one real sender (type wordingApproved=false holds them).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { VEEC_OFFICE_ALERT_EVENT, VEEC_REMINDER_EVENT, VEEC_SIGN_EMAIL_APPROVED, nextVeecReminderStep, veecSignEmail, veecSignReminderText, veecSignRequestText, type VeecReminderStep } from "./veec-assignment-form.core";

const ACTIVE_STAGES = ["evidence_outstanding", "ap_review"] as const;

async function doneSteps(jobId: string): Promise<VeecReminderStep[]> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", VEEC_REMINDER_EVENT);
  return (data ?? []).map((e) => (e.details as { step?: VeecReminderStep } | null)?.step).filter((s): s is VeecReminderStep => !!s);
}

/** Sends one step (email + text) to the owner. Records the step first; never sends twice for the same step. */
export async function sendVeecSignStep(jobId: string, step: VeecReminderStep): Promise<string> {
  if (step === "office_alert_10") {
    const { data: dup } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", VEEC_OFFICE_ALERT_EVENT).limit(1);
    if ((dup ?? []).length) return "already alerted";
    await logEvent(jobId, null, VEEC_REMINDER_EVENT, "VEEC assignment: day-10 office alert raised", { step }, { internal: true });
    await logEvent(jobId, null, VEEC_OFFICE_ALERT_EVENT, "10 days since the install and the owner has not signed the VEEC assignment form. Needs Home Insulation Victoria", { step });
    return "office alerted";
  }
  if ((await doneSteps(jobId)).includes(step)) return "already handled";
  await logEvent(jobId, null, VEEC_REMINDER_EVENT, `VEEC assignment signing ${step === "request" ? "request" : "reminder"} (${step}) prepared for the owner`, { step }, { internal: true });
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: ag }, { data: asg }, link] = await Promise.all([
    admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle(),
    admin.from("customer_agreements").select("veu_benefit_inc_gst").eq("job_id", jobId).eq("status", "signed").maybeSingle(),
    admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(jobId),
  ]);
  if (!link) { await logEvent(jobId, null, "veec_sign_request_not_sent", "No working owner job link, so the owner could not be asked to sign the VEEC assignment form", { step }, { internal: true }); return "not sent — owner link missing"; }
  const url = `${link}?screen=done`;
  const rebate = Number(ag?.veu_benefit_inc_gst ?? 0);
  const { firstName } = await import("./worker-links.core");
  const smsBody = step === "request" ? veecSignRequestText(rebate, url) : veecSignReminderText(rebate, url);
  const smsType = step === "request" ? "veec_sign_request" : "veec_sign_reminder";
  const key = `veec-sign:v1:${jobId}:${step}`;
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `veec_sign:${step}`, actorId: null };
    const mail = veecSignEmail({ firstName: firstName(owner?.full_name ?? null), rebate, link: url, step, test: true });
    const email = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    const sms = await sendTestSms(ctx, owner?.phone ?? "", smsBody);
    return `email ${email.status}: ${email.detail}; sms ${sms.status}: ${sms.detail}`;
  }
  const out: string[] = [];
  if (!VEEC_SIGN_EMAIL_APPROVED) out.push("email not sent — wording awaiting approval");
  else if (!owner?.email) out.push("email not sent — no owner email");
  else {
    const { assertCustomerDeliveryAllowed } = await import("./comms.server");
    try {
      await assertCustomerDeliveryAllowed(jobId, "VEEC assignment signing email");
      out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: `veec_sign_${step}`, key, build: () => veecSignEmail({ firstName: firstName(owner?.full_name ?? null), rebate, link: url, step, test: false }) })}`);
    } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
  }
  // The one real text sender: wording not approved → blocked and recorded, never sent.
  // Decision 165 (`window` type): this step was recorded as done above before any send, so a switch flip never re-fires an
  // old step; the next due step (day 1/3/7) is recomputed each tick and goes once when allowed.
  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({ type: smsType, idempotencyKey: key, to: owner?.phone ?? null, body: smsBody, jobId });
  out.push(`sms ${s.status}: ${s.detail}`);
  return out.join("; ");
}

/** 15-minute tick: one due step per unsigned job; executed copies not yet emailed are retried (idempotent on copy_sent_at). */
export async function sweepVeecReminders(now = new Date()): Promise<{ checked: number; sent: number; alerts: number; copies: number }> {
  const { data: jobs } = await admin.from("jobs").select("id, installation_completed_at").in("stage", ACTIVE_STAGES).not("installation_completed_at", "is", null).is("deleted_at", null);
  let sent = 0, alerts = 0, copies = 0;
  const { data: pendingCopies } = await admin.from("customer_assignments").select("job_id").eq("record_kind", "final_veec_assignment").eq("status", "effective_complete").is("copy_sent_at", null).not("consumer_signed_at", "is", null);
  const { sendVeecCopyEmail } = await import("./veec-copy-email.server");
  for (const c of pendingCopies ?? []) { try { if ((await sendVeecCopyEmail(c.job_id)).startsWith("sent")) copies++; } catch (e) { console.error("VEEC copy email failed", c.job_id, (e as Error).message); } }
  for (const j of jobs ?? []) {
    const { data: a } = await admin.from("customer_assignments").select("consumer_signed_at").eq("job_id", j.id).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").maybeSingle();
    const step = nextVeecReminderStep({ installCompletedAt: j.installation_completed_at, consumerSignedAt: a?.consumer_signed_at ?? null, done: await doneSteps(j.id), now: now.toISOString() });
    if (!step) continue;
    try { await sendVeecSignStep(j.id, step); if (step === "office_alert_10") alerts++; else sent++; } catch (e) { console.error("VEEC reminder failed", j.id, (e as Error).message); }
  }
  return { checked: (jobs ?? []).length, sent, alerts, copies };
}
