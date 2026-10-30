import { inHouseDispatchSkip } from "./in-house-suppression.server";
// Decision 158 (Jo, 24 Oct 2026): 20- and 10-day reminders to BOTH the owner and the installer while no install day is
// agreed inside the 30-day window, and — when the window lapses with nothing booked — an internal record of who pays
// the repeat PIESA (`repeatPiesaPayer`). Pure rules + DRAFT wording in thirty-day-rule.core.ts.
// Every reminder step is recorded once as an `install_window_reminder` event BEFORE anything is sent, so the 15-minute
// tick never repeats a step. TEST jobs / TEST partners use the test sender; real owners get email only once
// THIRTY_DAY_REMINDER_APPROVED is true, and texts only through the one real sender (types wordingApproved=false hold them).
// The existing single office alert at 10 days (`sweepInstallDays`) is untouched.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  INSTALL_WINDOW_EXPIRED_EVENT, INSTALL_WINDOW_REMINDER_EVENT, THIRTY_DAY_REMINDER_APPROVED, dueInstallWindowReminder, installWindowKey, installerInstallWindowEmail, installerInstallWindowText,
  ownerInstallWindowEmail, ownerInstallWindowText, repeatPiesaCharge, repeatPiesaNextAction, repeatPiesaPayer, repeatPiesaPayerLine, type InstallWindowEvent, type InstallWindowStep,
} from "./thirty-day-rule.core";
import { installDaysLeft } from "./install-days.core";

const PAYER_EVENT_TYPES = ["install_days_offered_by_installer", "install_days_offered", "install_day_taken", "install_day_changed", "install_day_booking_blocked"];

/** Steps already recorded for THIS window (deadline): a later clearance with a new deadline gets its own 20/10-day reminders. */
export async function doneSteps(jobId: string, deadline: string): Promise<InstallWindowStep[]> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", INSTALL_WINDOW_REMINDER_EVENT);
  return (data ?? []).map((e) => e.details as { step?: InstallWindowStep; deadline?: string } | null)
    .filter((d) => d?.deadline === deadline).map((d) => d?.step).filter((s): s is InstallWindowStep => !!s);
}

/** One reminder step (owner text + email, installer text + email). Records the step first; never sends twice per deadline. */
export async function sendInstallWindowReminder(jobId: string, step: InstallWindowStep, deadline: string, now = new Date()): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  if ((await doneSteps(jobId, deadline)).includes(step)) return "already handled";
  const daysLeft = installDaysLeft(deadline, now);
  await logEvent(jobId, null, INSTALL_WINDOW_REMINDER_EVENT, `30-day window: ${step === "reminder_20" ? "20" : "10"}-day reminder prepared for the owner and the installer (${daysLeft} days left, last day ${deadline})`, { step, deadline, days_left: daysLeft }, { internal: true });
  const [{ data: job }, { data: asg }, link] = await Promise.all([
    admin.from("jobs").select("job_number, source, owner_id, owners(full_name, email, phone), properties(suburb)").eq("id", jobId).maybeSingle(),
    admin.from("job_assignments").select("user_id, business_id, profiles:user_id(full_name, email, phone), businesses(name, trading_name, email, phone, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(jobId),
  ]);
  if (!job) return "skipped";
  const owner = (job.owners ?? null) as { full_name: string | null; email: string | null; phone: string | null } | null;
  const prof = (asg?.profiles ?? null) as { full_name: string | null; email: string | null; phone: string | null } | null;
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; email: string | null; phone: string | null; onboarding_notes?: string | null } | null;
  const suburb = (job.properties as { suburb: string | null } | null)?.suburb ?? null;
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const { isTestPartner } = await import("./test-send.core");
  const { firstName } = await import("./worker-links.core");
  const test = job.source === "qa_test";
  const partnerTest = test || isTestPartner(biz);
  const installerName = biz?.trading_name || biz?.name || null;
  const ownerFacts = { step, deadline, daysLeft, link: link ?? "", jobNumber: job.job_number, firstName: firstName(owner?.full_name), installerName, test };
  const instFacts = { step, deadline, daysLeft, link: `${SET_PASSWORD_BASE}/field/${jobId}`, jobNumber: job.job_number, firstName: firstName(prof?.full_name), ownerSuburb: suburb, test: partnerTest };
  const key = (who: "owner" | "installer", ch: "email" | "sms") => installWindowKey(jobId, deadline, step, who, ch);
  const out: string[] = [];

  // Owner
  if (!link) { await logEvent(jobId, null, "install_window_reminder_not_sent", "No working owner job link, so the owner's 30-day window reminder could not be sent", { step }, { internal: true }); out.push("owner: not sent — owner link missing"); }
  else if (test) {
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: false, label: `install_window:${step}:owner`, actorId: null };
    const mail = ownerInstallWindowEmail(ownerFacts);
    const e = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    const s = await sendTestSms(ctx, owner?.phone ?? "", ownerInstallWindowText(ownerFacts));
    out.push(`owner email ${e.status}: ${e.detail}; owner sms ${s.status}: ${s.detail}`);
  } else {
    if (!THIRTY_DAY_REMINDER_APPROVED) out.push("owner email not sent — wording awaiting approval");
    else if (!owner?.email) out.push("owner email not sent — no owner email");
    else {
      try {
        await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "30-day window reminder email");
        out.push(`owner email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: `install_window_${step}`, key: key("owner", "email"), build: () => ownerInstallWindowEmail(ownerFacts) })}`);
      } catch (e) { out.push(`owner email not sent — ${(e as Error).message}`); }
    }
    const { sendRealSms } = await import("./sms.server");
    const s = await sendRealSms({ type: "install_window_reminder", idempotencyKey: key("owner", "sms"), to: owner?.phone ?? null, body: ownerInstallWindowText(ownerFacts), jobId });
    out.push(`owner sms ${s.status}: ${s.detail}`);
  }

  // Installer
  if (!asg) out.push("installer: not sent — no quoted installer");
  else if (partnerTest) {
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: true, label: `install_window:${step}:installer`, actorId: null };
    const mail = installerInstallWindowEmail(instFacts);
    const e = await sendTestEmail(ctx, prof?.email ?? biz?.email ?? "", mail.subject, mail.html, mail.text);
    const s = await sendTestSms(ctx, prof?.phone ?? biz?.phone ?? "", installerInstallWindowText(instFacts));
    out.push(`installer email ${e.status}: ${e.detail}; installer sms ${s.status}: ${s.detail}`);
  } else {
    const to = prof?.email ?? biz?.email ?? null;
    if (!THIRTY_DAY_REMINDER_APPROVED) out.push("installer email not sent — wording awaiting approval");
    else if (!to) out.push("installer email not sent — no installer email");
    else {
      const mail = installerInstallWindowEmail(instFacts);
      const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to, contactName: prof?.full_name ?? null, subject: mail.subject, message: mail.text, label: `install_window_${step}`, record: { businessId: asg.business_id }, html: mail.html, text: mail.text });
      out.push(`installer email ${r.status}: ${r.detail}`);
    }
    const { sendRealSms } = await import("./sms.server");
    const s = await sendRealSms({ type: "install_window_reminder_installer", idempotencyKey: key("installer", "sms"), to: prof?.phone ?? biz?.phone ?? null, body: installerInstallWindowText(instFacts), jobId, businessId: asg.business_id });
    out.push(`installer sms ${s.status}: ${s.detail}`);
  }
  return out.join("; ");
}

/** When the window lapses with nothing booked: record who pays the repeat PIESA, once. Internal event, shown in the job history. */
export async function recordInstallWindowExpiry(jobId: string, deadline: string, clearanceDate: string | null): Promise<string> {
  const { data: dup } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", INSTALL_WINDOW_EXPIRED_EVENT).contains("details", { deadline }).limit(1);
  if ((dup ?? []).length) return "already recorded";
  const { data: rows } = await admin.from("workflow_events").select("event_type, created_at, summary, details").eq("job_id", jobId).in("event_type", PAYER_EVENT_TYPES).order("created_at");
  const events: InstallWindowEvent[] = (rows ?? []).map((r) => ({ type: r.event_type, at: r.created_at, summary: r.summary, details: (r.details ?? null) as NonNullable<InstallWindowEvent["details"]> | null }));
  const decision = repeatPiesaPayer({ clearanceDate, deadline, expired: true, booked: false, events });
  // Decision 342: the owner's repeat charge = their first safety check (the accepted quote's PIESA line, decision 302).
  // Nothing charges it automatically: the figure is recorded on this event for the office / invoice to use.
  const { data: acc } = await admin.from("quotes").select("id").eq("job_id", jobId).eq("kind", "installation").eq("status", "accepted").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const first = acc?.id ? await (await import("./safety-check-amount.server")).quoteSafetyCheck(acc.id).catch(() => null) : null;
  const charge = repeatPiesaCharge(decision, first);
  await logEvent(jobId, null, INSTALL_WINDOW_EXPIRED_EVENT, `${repeatPiesaPayerLine(decision)} (decision 158 — new PIESA needed)`, { deadline, clearance_date: clearanceDate, payer: decision.payer, basis: decision.basis, reason: decision.reason, quote_id: acc?.id ?? null, owner_charge_inc_gst: charge.ownerChargeIncGst, first_safety_check_inc_gst: charge.firstSafetyCheckIncGst, first_safety_check_source: charge.firstSafetyCheckSource }, { internal: true });
  await admin.from("jobs").update({ next_action: repeatPiesaNextAction(charge) }).eq("id", jobId);
  return decision.payer;
}

/** 15-minute tick: one due reminder per job with nothing booked; the payer record once the window has lapsed. */
export async function sweepInstallWindowRule(now = new Date()): Promise<{ checked: number; reminders: number; expired: number }> {
  const { installDayContext } = await import("./install-days.server");
  const { data: jobs } = await admin.from("jobs").select("id").eq("stage", "installation_scheduling").is("deleted_at", null);
  // F10: a step is recorded before its texts go out, so during SMS quiet hours nothing is due — it fires at the 07:00 tick.
  const quiet = !!(await import("./quote-hold.core")).smsQuietReason(now.toISOString());
  let reminders = 0, expired = 0;
  for (const j of jobs ?? []) {
    try {
      const c = await installDayContext(j.id);
      if (!c.deadline || c.booked) continue;
      if (c.expired) { if ((await recordInstallWindowExpiry(j.id, c.deadline, c.clearance.timingDate)) !== "already recorded") expired++; continue; }
      const step = dueInstallWindowReminder({ deadline: c.deadline, booked: c.booked, expired: c.expired, done: await doneSteps(j.id, c.deadline), now, quiet });
      if (!step) continue;
      await sendInstallWindowReminder(j.id, step, c.deadline, now);
      reminders++;
    } catch (e) { console.error("30-day rule sweep failed", j.id, (e as Error).message); }
  }
  return { checked: (jobs ?? []).length, reminders, expired };
}
