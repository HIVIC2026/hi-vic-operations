// Decision 328 (Jo, 25 Oct 2026): confirm the "A5 – Install day" Mitti form before the installer leaves site. Rules and
// wording are pure in install-day-confirm.core.ts. This module:
//  - `checkInstallDayForm`: runs the single-job A5 sync (`syncPiisaDeclaration`, the same path as the 15-minute Mitti sync)
//    and turns what it read into ONE result; when the audit is Complete and the install is today, the lead installer is
//    texted that result once per audit revision (`install_day_form_result_sent` recorded BEFORE any send).
//  - `sweepInstallDayForms` (15-minute allocation tick): today's installs only — runs the check, then the 5pm reminder
//    when the form is still not Complete (`install_day_form_reminder_sent` recorded BEFORE any send, once per day).
// TEST jobs / TEST partners → test-send only; real partners → the ONE real sender (`sendRealSms`: customer_comms_enabled,
// the type's own switch, STOP, approved partner; no fallback connection, no retry; a held attempt never claims the key).
// Never changes a stage, a booking or the form; the installation is still recorded only by the guarded completion path.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  INSTALL_DAY_REMINDER_EVENT, INSTALL_DAY_RESULT_EVENT, installDayFormResult, installDayReminderKey, installDayReminderText, installDayResultKey,
  installDayResultText, installDayScreenLine, isInstallDayToday, melbourneParts, reminderDue, resultTextDue, type InstallDayFormResult,
} from "./install-day-confirm.core";
import type { MittiCall } from "./mitti.core";

type JobRow = { id: string; job_number: string; source: string | null; deleted_at: string | null; installation_completed_at: string | null; properties: { address_line: string | null; suburb: string | null } | null };
type BizRow = { id: string; name: string | null; signer_mobile: string | null; phone: string | null; onboarding_notes: string | null };

export type InstallDayCheck = InstallDayFormResult & { title: string; body: string; good: boolean; auditId: string | null; texted: string | null };

async function installDays(jobId: string): Promise<{ start: string | null; end: string | null }> {
  const { data } = await admin.from("bookings").select("scheduled_start, scheduled_end").eq("job_id", jobId).eq("kind", "installation").in("status", ["confirmed", "completed"]).order("scheduled_start", { ascending: true }).limit(1).maybeSingle();
  const { melbourneDateOf } = await import("./install-evidence.server");
  return { start: melbourneDateOf(data?.scheduled_start), end: melbourneDateOf(data?.scheduled_end) };
}

async function eventWithKey(jobId: string, type: string, key: string): Promise<boolean> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", type).contains("details", { key }).limit(1).maybeSingle();
  return !!data;
}

/** The lead installer going today: the allocated install person, else the business owner (same rule as install tomorrow). */
async function leadInstaller(jobId: string): Promise<{ businessId: string; biz: BizRow | null; to: string | null; name: string; recipient: string } | null> {
  const { data: asg } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle();
  if (!asg?.business_id) return null;
  const { data: biz } = await admin.from("businesses").select("id, name, signer_mobile, phone, onboarding_notes").eq("id", asg.business_id).maybeSingle();
  const b = (biz ?? null) as BizRow | null;
  const { allocatedPersonFor } = await import("./visit-allocation.server");
  const { dailyTextRecipient } = await import("./visit-allocation.core");
  const r = dailyTextRecipient({ allocated: await allocatedPersonFor(jobId, "install"), owner: { name: b?.name ?? "Trade", phone: b?.signer_mobile ?? b?.phone ?? null } });
  return { businessId: asg.business_id, biz: b, to: r.phone, name: r.name, recipient: r.key };
}

async function deliver(p: { type: "install_day_form_result" | "install_day_form_reminder"; key: string; job: JobRow; businessId: string; biz: BizRow | null; to: string | null; body: string; label: string }): Promise<string> {
  if (!p.to) return "not sent: no mobile for the lead installer";
  const { isTestPartner } = await import("./test-send.core");
  const test = p.job.source === "qa_test" || isTestPartner(p.biz ?? {});
  try {
    if (test) {
      const { sendTestSms } = await import("./test-send.server");
      const r = await sendTestSms({ jobId: p.job.id, jobSource: p.job.source, partnerIsTest: isTestPartner(p.biz ?? {}), label: p.label, actorId: null }, p.to, p.body);
      return `install day sms (test) ${r.status}: ${r.detail}`;
    }
    const { sendRealSms } = await import("./sms.server");
    const r = await sendRealSms({ type: p.type, idempotencyKey: p.key, to: p.to, body: p.body, jobId: p.job.id, businessId: p.businessId });
    return `install day sms ${r.status}: ${r.detail}`;
  } catch (e) { return `install day sms not sent — ${(e as Error).message}`; }
}

async function loadJob(jobId: string): Promise<JobRow | null> {
  const { data } = await admin.from("jobs").select("id, job_number, source, deleted_at, installation_completed_at, properties(address_line, suburb)").eq("id", jobId).maybeSingle();
  return (data ?? null) as unknown as JobRow | null;
}

/** Check the job's A5 now (the single-job sync) and, when it is Complete on an install day, text the result once per revision. */
export async function checkInstallDayForm(jobId: string, opts: { actorId?: string | null; now?: Date; call?: MittiCall | undefined } = {}): Promise<InstallDayCheck> {
  const now = opts.now ?? new Date();
  const job = await loadJob(jobId);
  if (!job || job.deleted_at) throw new Error("Job not found.");
  let a3: import("./piisa-declaration.server").A3SyncInfo | null = null;
  const { syncPiisaDeclaration } = await import("./piisa-declaration.server");
  const sync = await syncPiisaDeclaration(jobId, opts.actorId ?? null, opts.call, { onA3: (info) => { a3 = info; } });
  const info = a3 as import("./piisa-declaration.server").A3SyncInfo | null;
  const result: InstallDayFormResult = info
    ? installDayFormResult({ formCompleted: info.completed, installDayForm: info.installDay, finalTickTicked: info.finalTickTicked, declaration: { ok: sync.status === "saved" || sync.status === "already", message: sync.message }, summary: info.summary })
    : { state: "not_complete", missing: [] };
  const screen = info ? installDayScreenLine(result) : { title: "No install day form yet", body: sync.message, good: false };
  let texted: string | null = null;
  if (info && result.state !== "not_complete") {
    const days = await installDays(jobId);
    const key = installDayResultKey(jobId, info.auditId, info.modifiedAt);
    const today = melbourneParts(now).ymd;
    if (resultTextDue({ formCompleted: info.completed, installDayToday: isInstallDayToday(today, days.start, days.end), alreadySentForRevision: await eventWithKey(jobId, INSTALL_DAY_RESULT_EVENT, key) })) {
      const lead = await leadInstaller(jobId);
      const { installerTextAddress } = await import("./installer-texts.core");
      const body = installDayResultText(result, { jobNumber: job.job_number, address: installerTextAddress(job.properties?.address_line, job.properties?.suburb) });
      if (lead && body) {
        // Claimed once per audit revision, BEFORE any send: the next tick / button press finds this event and stops.
        await logEvent(jobId, opts.actorId ?? null, INSTALL_DAY_RESULT_EVENT, `Lead installer texted the install day form result (decision 328): ${result.state === "all_filled_in" ? "all filled in" : `not finished (${result.missing.length} item${result.missing.length === 1 ? "" : "s"})`} — text prepared for ${lead.name}`, { key, audit_id: info.auditId, revision: info.modifiedAt, state: result.state, missing: result.missing, recipient: lead.recipient, business_id: lead.businessId }, { internal: true });
        texted = await deliver({ type: "install_day_form_result", key, job, businessId: lead.businessId, biz: lead.biz, to: lead.to, body, label: `install_day_form_result:${info.auditId}` });
      }
    }
  }
  return { ...result, ...screen, auditId: info?.auditId ?? null, texted };
}

/** 15-minute tick: today's installs — check newly Complete A3s (result text once per revision), then the 5pm reminder. */
export async function sweepInstallDayForms(now = new Date(), opts: { call?: MittiCall; limit?: number } = {}): Promise<{ checked: number; texted: number; reminders: number }> {
  const today = melbourneParts(now).ymd;
  const from = new Date(now.getTime() - 14 * 86_400_000).toISOString(), to = new Date(now.getTime() + 86_400_000).toISOString();
  const { data: rows, error } = await admin.from("bookings").select("job_id, scheduled_start, scheduled_end, jobs!inner(deleted_at, business_unit, installation_completed_at)")
    .eq("kind", "installation").in("status", ["confirmed", "completed"]).gte("scheduled_start", from).lt("scheduled_start", to).eq("jobs.business_unit", "hivic").is("jobs.deleted_at", null).limit(opts.limit ?? 50);
  if (error) throw new Error(`Today's installs could not be read: ${error.message}`);
  const { melbourneDateOf } = await import("./install-evidence.server");
  let checked = 0, texted = 0, reminders = 0;
  for (const r of rows ?? []) {
    const start = melbourneDateOf(r.scheduled_start), end = melbourneDateOf(r.scheduled_end);
    if (!isInstallDayToday(today, start, end)) continue;
    const jobId = r.job_id as string;
    const { data: created } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "mitti_piisa_audit_created").limit(1).maybeSingle();
    const recorded = !!(r.jobs as { installation_completed_at: string | null } | null)?.installation_completed_at;
    // Already recorded and already confirmed: nothing left to tell the installer today.
    if (recorded && (await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", INSTALL_DAY_RESULT_EVENT).limit(1).maybeSingle()).data) continue;
    let completed = false;
    if (created) {
      try {
        const c = await checkInstallDayForm(jobId, { now, call: opts.call });
        checked++; completed = c.state !== "not_complete"; if (c.texted) texted++;
      } catch (e) { console.error("install day form check failed", (e as Error).message); continue; }
    }
    const lastDay = end && start && end >= start ? end : start;
    const rKey = installDayReminderKey(jobId, lastDay ?? today);
    if (!reminderDue({ now, lastInstallDay: lastDay, formCompleted: completed, installationRecorded: recorded, alreadySent: await eventWithKey(jobId, INSTALL_DAY_REMINDER_EVENT, rKey) })) continue;
    const job = await loadJob(jobId);
    const lead = job ? await leadInstaller(jobId) : null;
    if (!job || !lead) continue;
    await logEvent(jobId, null, INSTALL_DAY_REMINDER_EVENT, `Lead installer texted at 5pm: the install day form isn't complete yet (decision 328) — text prepared for ${lead.name}`, { key: rKey, install_date: lastDay, recipient: lead.recipient, business_id: lead.businessId }, { internal: true });
    await deliver({ type: "install_day_form_reminder", key: rKey, job, businessId: lead.businessId, biz: lead.biz, to: lead.to, body: installDayReminderText({ jobNumber: job.job_number }), label: `install_day_form_reminder:${jobId}:${lastDay}` });
    reminders++;
  }
  return { checked, texted, reminders };
}
