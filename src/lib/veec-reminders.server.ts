// Decision 120 (Jo, 24 Oct 2026): ask the owner to sign the VEEC assignment form by EMAIL AND TEXT when the install is
// recorded complete, remind on days 1, 3 and 7, and alert the office on day 10. Pure schedule + text wording in
// veec-assignment-form.core.ts, email renderers in veec-emails.core.ts. Every step is recorded once as a
// `veec_sign_reminder` workflow event before anything is sent, so a 15-minute tick never repeats a step.
// Decision 169: the day-0 request EMAIL is the approved All done email (O44) — sent once per job through
// `emailOwnerInstallComplete` (key install-complete:v1:<job>), never as a separate request email; days 1/3/7 send O61.
// TEST jobs use test-send; real owners get email only through the guarded owner path (customer_comms_enabled + consent)
// and texts only through the one real sender (types veec_sign_request / veec_sign_reminder).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { VEEC_OFFICE_ALERT_EVENT, VEEC_REMINDER_EVENT, nextVeecReminderStep, veecSignReminderText, veecSignRequestText, type VeecReminderStep } from "./veec-assignment-form.core";
import { VEEC_SIGN_EMAIL_APPROVED, renderVeecReminderEmail } from "./veec-emails.core";

const ACTIVE_STAGES = ["evidence_outstanding", "ap_review"] as const;
/** Recorded on the step event when the All done email carries the request (no separate request email exists). */
export const REQUEST_CARRIED_BY_ALL_DONE = "request carried by the All done email";

async function doneSteps(jobId: string): Promise<VeecReminderStep[]> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", VEEC_REMINDER_EVENT);
  return (data ?? []).map((e) => (e.details as { step?: VeecReminderStep } | null)?.step).filter((s): s is VeecReminderStep => !!s);
}

/** Facts the All done email shows: what was quoted/installed, the rebate and whether the balance is paid. Nothing invented. */
async function installCompleteFacts(jobId: string) {
  const [{ data: ag }, { data: inv }] = await Promise.all([
    admin.from("customer_agreements").select("quoted_product, quoted_area_m2, veu_benefit_inc_gst").eq("job_id", jobId).eq("status", "signed").maybeSingle(),
    admin.from("invoices").select("total_inc_gst, total_paid").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const rebate = Number(ag?.veu_benefit_inc_gst ?? 0);
  const total = inv ? Number(inv.total_inc_gst ?? 0) : null, paid = inv ? Number(inv.total_paid ?? 0) : 0;
  return {
    product: ag?.quoted_product?.trim() || null,
    areaM2: ag?.quoted_area_m2 != null && Number(ag.quoted_area_m2) > 0 ? Number(ag.quoted_area_m2) : null,
    rebate: rebate > 0 ? rebate : null,
    balancePaid: total != null && total > 0 && paid + 0.005 >= total,
  };
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
  const request = step === "request";
  await logEvent(jobId, null, VEEC_REMINDER_EVENT, request ? `VEEC assignment signing request (${step}) prepared for the owner: ${REQUEST_CARRIED_BY_ALL_DONE} plus the approved text` : `VEEC assignment signing reminder (${step}) prepared for the owner`, { step, ...(request ? { email: REQUEST_CARRIED_BY_ALL_DONE } : {}) }, { internal: true });
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: asg }, link, facts] = await Promise.all([
    admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(jobId),
    installCompleteFacts(jobId),
  ]);
  if (!link) { await logEvent(jobId, null, "veec_sign_request_not_sent", "No working owner job link, so the owner could not be asked to sign the VEEC assignment form", { step }, { internal: true }); return "not sent — owner link missing"; }
  const url = `${link}?screen=done`;
  const rebate = facts.rebate ?? 0;
  const { firstName } = await import("./worker-links.core");
  const smsBody = request ? veecSignRequestText(rebate, url) : veecSignReminderText(rebate, url);
  const smsType = request ? "veec_sign_request" : "veec_sign_reminder";
  const key = `veec-sign:v1:${jobId}:${step}`;
  const out: string[] = [];
  if (request) {
    // The All done email IS the request (decision 169). One per job by its own key, TEST → test-send, real → guarded path.
    const { emailOwnerInstallComplete } = await import("./approved-owner-emails.server");
    out.push(`All done email ${await emailOwnerInstallComplete(jobId, { product: facts.product, areaM2: facts.areaM2, rebate: facts.rebate, balancePaid: facts.balancePaid, signRebateFormUrl: url })}`);
  }
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `veec_sign:${step}`, actorId: null };
    if (!request) {
      const mail = renderVeecReminderEmail({ firstName: firstName(owner?.full_name ?? null), rebate, signUrl: url, unsubscribeUrl: null, test: true });
      const email = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
      out.push(`email ${email.status}: ${email.detail}`);
    }
    const sms = await sendTestSms(ctx, owner?.phone ?? "", smsBody);
    out.push(`sms ${sms.status}: ${sms.detail}`);
    return out.join("; ");
  }
  if (!request) {
    if (!VEEC_SIGN_EMAIL_APPROVED) out.push("email not sent — wording awaiting approval");
    else if (!owner?.email) out.push("email not sent — no owner email");
    else {
      const { assertCustomerDeliveryAllowed } = await import("./comms.server");
      try {
        await assertCustomerDeliveryAllowed(jobId, "VEEC assignment signing reminder email");
        out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: `veec_sign_${step}`, key, build: (unsubscribeUrl) => renderVeecReminderEmail({ firstName: firstName(owner?.full_name ?? null), rebate, signUrl: url, unsubscribeUrl, test: false }) })}`);
      } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
    }
  }
  // The one real text sender: every switch/consent/opt-out check lives there; blocked texts are recorded, never sent.
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
