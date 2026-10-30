import { inHouseDispatchSkip } from "./in-house-suppression.server";
// Decision 186 (Jo, 24 Oct 2026): when electrical clearance becomes valid (allocation.core `electricalClearance`:
// PIESA passed with no fixes, or fixes completed + Section C signed), the assigned installer business gets ONE text
// (`install_clearance`) and ONE email (I65) asking them to offer the owner 3 install days before the 30-day deadline.
// Called from the two places clearance is established (portal.functions completeAssessment / recordPiesa) and swept
// by the 15-minute tick for jobs cleared before this existed (last 7 days, nothing booked). The notice is recorded
// ONCE per job + clearance timing date as an `install_clearance_notified` workflow event BEFORE anything is sent.
// TEST jobs / TEST partners → test-send only; real partners → sendOfficeEmail (partner) + the one real SMS sender.
// Owner notifications and the install-days turn logic are untouched.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  INSTALL_CLEARANCE_EMAIL_APPROVED, INSTALL_CLEARANCE_EVENT, INSTALL_CLEARANCE_SMS_TYPE, installClearanceDeadlineLabel, installClearanceKeys, installClearanceText, renderInstallClearanceEmail,
} from "./install-clearance.core";

export const INSTALL_CLEARANCE_SWEEP_DAYS = 7;

function ymdDaysAgo(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/** Tell the assigned installer the job is cleared — once per clearance. Returns a short outcome line (never throws on send problems). */
export async function notifyInstallerClearance(jobId: string, opts: { clearedAt?: string | null } = {}): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  const { installDayContext } = await import("./install-days.server");
  const c = await installDayContext(jobId);
  if (!c.clearance.cleared || !c.clearance.timingDate) return "not cleared";
  const timingDate = c.clearance.timingDate.slice(0, 10);
  if (!c.asg) return "no installer assigned";
  if (!c.deadline) return "no deadline";
  const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", INSTALL_CLEARANCE_EVENT).contains("details", { timing_date: timingDate }).limit(1).maybeSingle();
  if (prior) return "already handled";

  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("job_number, source, owners(full_name)").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("user_id, business_id, profiles:user_id(full_name, email, phone), businesses(name, trading_name, email, phone, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  if (!job || !asg) return "skipped";
  const clearedAt = opts.clearedAt ?? new Date().toISOString();
  await logEvent(jobId, null, INSTALL_CLEARANCE_EVENT, `Installer told the job is cleared for install (${c.clearance.basis === "section_c" ? "fixes signed off" : c.clearance.basis === "electrician_at_start" ? "fixes quote paid, electrician on site at the start" : "PIESA passed"}): offer 3 install days by ${c.deadline} — text + email prepared`, { timing_date: timingDate, basis: c.clearance.basis, deadline: c.deadline, cleared_at: clearedAt, assignment_id: c.asg.id }, { internal: true });

  const prof = (asg.profiles ?? null) as { full_name: string | null; email: string | null; phone: string | null } | null;
  const biz = (asg.businesses ?? null) as { name: string | null; trading_name: string | null; email: string | null; phone: string | null; onboarding_notes?: string | null } | null;
  const owner = (job.owners ?? null) as { full_name: string | null } | null;
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const { isTestPartner } = await import("./test-send.core");
  const { firstName } = await import("./worker-links.core");
  const test = job.source === "qa_test" || isTestPartner(biz);
  const link = `${SET_PASSWORD_BASE}/field/${jobId}`;
  const deadlineLabel = installClearanceDeadlineLabel(c.deadline);
  const mail = renderInstallClearanceEmail({ jobNumber: job.job_number, ownerFirstName: firstName(owner?.full_name), fixesSignedOff: c.clearance.basis === "section_c", deadlineLabel, jobUrl: link, test });
  const body = installClearanceText({ jobNumber: job.job_number, deadlineLabel, link });
  const emailTo = prof?.email ?? biz?.email ?? null;
  const phone = prof?.phone ?? biz?.phone ?? null;
  const keys = installClearanceKeys(jobId, timingDate);
  const out: string[] = [];

  if (test) {
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: true, label: `install_clearance:${timingDate}`, actorId: null };
    const e = await sendTestEmail(ctx, emailTo ?? "", mail.subject, mail.html, mail.text);
    const s = await sendTestSms(ctx, phone ?? "", body);
    out.push(`installer email ${e.status}: ${e.detail}`, `installer sms ${s.status}: ${s.detail}`);
    return out.join("; ");
  }

  if (!INSTALL_CLEARANCE_EMAIL_APPROVED) out.push("installer email not sent — wording awaiting approval");
  else if (!emailTo) out.push("installer email not sent — no installer email");
  else {
    try {
      const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to: emailTo, contactName: prof?.full_name ?? null, subject: mail.subject, message: mail.text, label: "install_clearance", record: { businessId: asg.business_id }, html: mail.html, text: mail.text });
      out.push(`installer email ${r.status}: ${r.detail}`);
    } catch (e) { out.push(`installer email not sent — ${(e as Error).message}`); }
  }
  try {
    const { sendRealSms } = await import("./sms.server");
    // Decision 165: the trigger is the clearance itself; a switch flipped on more than 24h later must not text an old clearance.
    const s = await sendRealSms({ type: INSTALL_CLEARANCE_SMS_TYPE, idempotencyKey: keys.sms, to: phone, body, jobId, businessId: asg.business_id, event: { at: clearedAt, current: !c.booked } });
    out.push(`installer sms ${s.status}: ${s.detail}`);
  } catch (e) { out.push(`installer sms not sent — ${(e as Error).message}`); }
  return out.join("; ");
}

/** When the current clearance record was written (the real clearance moment), for jobs cleared before this notice existed. */
async function clearanceRecordedAt(jobId: string, basis: import("./allocation.core").ClearanceBasis | null): Promise<string | null> {
  let q = admin.from("piesa_records").select("created_at").eq("job_id", jobId).eq("is_current", true);
  q = basis === "section_c" ? q.neq("kind", "initial") : q.eq("kind", "initial");
  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { created_at?: string | null } | null)?.created_at ?? null;
}

/** 15-minute tick: jobs in installation scheduling cleared in the last 7 days, nothing booked, not yet told — once each. */
export async function sweepInstallClearance(now = new Date()): Promise<{ checked: number; notified: number }> {
  const { installDayContext } = await import("./install-days.server");
  const since = ymdDaysAgo(now, INSTALL_CLEARANCE_SWEEP_DAYS);
  const { data: jobs } = await admin.from("jobs").select("id").eq("stage", "installation_scheduling").is("deleted_at", null);
  let notified = 0;
  for (const j of jobs ?? []) {
    try {
      const c = await installDayContext(j.id);
      if (!c.clearance.cleared || !c.clearance.timingDate || c.booked || !c.asg) continue;
      if (c.clearance.timingDate.slice(0, 10) < since) continue;
      const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", j.id).eq("event_type", INSTALL_CLEARANCE_EVENT).contains("details", { timing_date: c.clearance.timingDate.slice(0, 10) }).limit(1).maybeSingle();
      if (prior) continue;
      const clearedAt = (await clearanceRecordedAt(j.id, c.clearance.basis)) ?? `${c.clearance.timingDate.slice(0, 10)}T00:00:00+10:00`;
      const r = await notifyInstallerClearance(j.id, { clearedAt });
      if (r !== "already handled" && r !== "not cleared" && r !== "skipped" && r !== "in_house" && r !== "in_house_read_failed") notified++;
    } catch (e) { console.error("install clearance sweep failed", j.id, (e as Error).message); }
  }
  return { checked: (jobs ?? []).length, notified };
}
