// Jo 23 Oct 2026: runs on the 15-minute allocation tick. Creates the Mitti Ready Check form for installer jobs
// (and, HV-3542, HIV leads with a confirmed Ready Check booking) that don't have one yet, prefilled and assigned to the installer — the same createAssignMittiAudit path and
// atomic claim as the office button. Never sends to owners, never changes stage. Failures are flagged once a day.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import { AUTOFORM_FAILED_EVENT, AUTOFORM_MAX_PER_TICK, AUTOFORM_WINDOW_DAYS, autoFormDecision, isStageFailure } from "./mitti-autoform.core";
import { PRE_READY_CHECK_STAGES } from "./installer-new-jobs.core";

export type AutoFormResult = { jobId: string; jobNumber: string; outcome: "created" | "held" | "uncertain" | "failed"; message?: string };

export async function sweepReadyCheckForms(opts: { call?: MittiCall; now?: Date; dryRun?: boolean; enabled?: boolean } = {}) {
  const { AUTOFORM_ENABLED } = await import("./mitti-autoform.core");
  const enabled = opts.enabled ?? AUTOFORM_ENABLED;
  if (!enabled) return { checked: 0, results: [] as AutoFormResult[], wouldCreate: [] as string[], paused: true };
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - AUTOFORM_WINDOW_DAYS * 86_400_000).toISOString();
  const cols = "id, job_number, channel, source, stage, created_at, deleted_at, qa_archived_at, originating_installer_business_id";
  const [installerJobs, hivLeads] = await Promise.all([
    admin.from("jobs").select(cols)
      .eq("channel", "installer_sourced").is("deleted_at", null).is("qa_archived_at", null)
      .in("stage", [...PRE_READY_CHECK_STAGES]).gte("created_at", since).order("created_at").limit(500),
    // HV-3542 (Jo 30 Oct): booked HIV website leads too. No created-date filter: their 30 days count from the booking.
    admin.from("jobs").select(cols)
      .eq("channel", "hivic_sourced").is("deleted_at", null).is("qa_archived_at", null)
      .eq("stage", "ready_check_scheduled").order("created_at").limit(500),
  ]);
  if (installerJobs.error || hivLeads.error) throw new Error(`Ready Check form sweep could not read jobs: ${(installerJobs.error ?? hivLeads.error)!.message}`);
  const jobs = [...(installerJobs.data ?? []), ...(hivLeads.data ?? [])];
  if (!jobs.length) return { checked: 0, results: [] as AutoFormResult[], wouldCreate: [] as string[] };
  const ids = jobs.map((j) => j.id);
  const hivIds = (hivLeads.data ?? []).map((j) => j.id);
  const [ws, measurements, assignments, failures, bookings] = await Promise.all([
    admin.from("workflow_settings").select("auto_send_mitti, mitti_ready_check_priced_template_id, mitti_ready_check_template_id").eq("id", 1).maybeSingle(),
    admin.from("ceiling_measurements").select("job_id, provenance, status, external_source, accepted_by").in("job_id", ids).eq("is_current", true),
    admin.from("job_assignments").select("job_id, user_id, business_id").in("job_id", ids).eq("role", "installer").eq("active", true),
    admin.from("workflow_events").select("job_id, created_at, details").in("job_id", ids).eq("event_type", AUTOFORM_FAILED_EVENT).order("created_at", { ascending: false }),
    hivIds.length
      ? admin.from("bookings").select("job_id, created_at").in("job_id", hivIds).eq("kind", "ready_check").eq("status", "confirmed").order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as { job_id: string; created_at: string }[], error: null }),
  ]);
  if (ws.error || measurements.error || assignments.error || failures.error || bookings.error) throw new Error("Ready Check form sweep could not read job facts.");
  const bizIds = [...new Set(jobs.map((j) => assignments.data?.find((a) => a.job_id === j.id)?.business_id ?? j.originating_installer_business_id).filter(Boolean) as string[])];
  const { data: businesses, error: be } = bizIds.length ? await admin.from("businesses").select("id, mitti_account_invited, onboarding_notes").in("id", bizIds) : { data: [], error: null };
  if (be) throw new Error("Ready Check form sweep could not read installers.");
  const measured = new Set((measurements.data ?? []).map((m) => m.job_id));
  const { provisionalGivesWayToMitti } = await import("./measurement.core");
  const provisional = new Set((measurements.data ?? []).filter((m) => provisionalGivesWayToMitti(m)).map((m) => m.job_id));
  const { isTestPartner } = await import("./test-send.core");

  const results: AutoFormResult[] = [];
  const wouldCreate: string[] = [];
  for (const j of jobs) {
    if (results.length >= AUTOFORM_MAX_PER_TICK) break;
    const asg = assignments.data?.find((a) => a.job_id === j.id) ?? null;
    const biz = businesses?.find((b) => b.id === (asg?.business_id ?? j.originating_installer_business_id)) ?? null;
    const lastFailure = failures.data?.find((f) => f.job_id === j.id) ?? null;
    const d = autoFormDecision({
      channel: j.channel, stage: j.stage, createdAt: j.created_at, deleted: !!j.deleted_at, archived: !!j.qa_archived_at,
      hasCurrentMeasurement: measured.has(j.id), provisionalOnly: provisional.has(j.id), installerUserId: asg?.user_id ?? null,
      mittiInvited: biz?.mitti_account_invited === true, templateSet: !!(j.channel === "hivic_sourced" ? ws.data?.mitti_ready_check_template_id : ws.data?.mitti_ready_check_priced_template_id)?.trim(), // HIV leads use the plain Ready Check form
      autoSendMitti: ws.data?.auto_send_mitti === true,
      lastFailureAt: lastFailure?.created_at ?? null,
      lastFailureReason: (lastFailure?.details as { reason?: string } | null)?.reason ?? null,
      bookedAt: bookings.data?.find((b) => b.job_id === j.id)?.created_at ?? null, // latest confirmed booking (sorted newest first)
    }, now, true);
    if (d.action !== "create") continue;
    if (opts.dryRun) { wouldCreate.push(j.job_number); continue; }
    // Practice jobs (qa_test or a TEST partner's job) only ever reach the TEST Mitti account.
    let assignee: { userId: string; fullName: string | null; email: string } | undefined;
    if (j.source === "qa_test" || isTestPartner(biz)) {
      const { TEST_MITTI_ASSIGNEE } = await import("./onsite-ready-check.core");
      assignee = { userId: asg!.user_id, fullName: null, email: TEST_MITTI_ASSIGNEE };
    }
    const { createAssignMittiAudit, realMittiCall } = await import("./mitti.server");
    const { MittiClaimHeld, MittiOutcomeUncertain } = await import("./mitti-create.server");
    try {
      await createAssignMittiAudit(j.id, null, opts.call ?? realMittiCall, { readyCheck: true, ...(assignee ? { assignee } : {}) });
      // Jo 24 Oct (HV-3151/HV-3164): Add a job runs the website checks, which leave "waiting for the owner to save
      // their spot". With its form made, the job waits on the installer instead, like a picked-up Mitti form.
      try { await (await import("./mitti-pickup.server")).holdAtMittiReadyCheck(j.id, null); } catch { /* the 15-minute pickup re-applies the hold */ }
      results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "created" });
    } catch (e) {
      if (e instanceof MittiClaimHeld) { results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "held" }); continue; }
      // Uncertain: createAssignMittiAudit already recorded an office flag and keeps the claim, so it never retries.
      if (e instanceof MittiOutcomeUncertain) { results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "uncertain" }); continue; }
      const message = e instanceof Error ? e.message : "Mitti error";
      // kind "stage": nothing reached Mitti, so the next tick retries once the stage is right; "mitti": a day's back-off.
      await logEvent(j.id, null, AUTOFORM_FAILED_EVENT, `Mitti Ready Check form could not be created automatically: ${message}`.slice(0, 500), { needs_office: true, reason: message.slice(0, 300), kind: isStageFailure(message) ? "stage" : "mitti" }, { internal: true }).catch(() => undefined);
      results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "failed", message });
    }
  }
  return { checked: jobs.length, results, wouldCreate };
}
