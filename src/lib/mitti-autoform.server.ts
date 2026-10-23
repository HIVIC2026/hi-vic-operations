// Jo 23 Oct 2026: runs on the 15-minute allocation tick. Creates the Mitti Ready Check form for installer jobs
// that don't have one yet, prefilled and assigned to the installer — the same createAssignMittiAudit path and
// atomic claim as the office button. Never sends to owners, never changes stage. Failures are flagged once a day.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import { AUTOFORM_FAILED_EVENT, AUTOFORM_MAX_PER_TICK, AUTOFORM_WINDOW_DAYS, autoFormDecision } from "./mitti-autoform.core";
import { PRE_READY_CHECK_STAGES } from "./installer-new-jobs.core";

export type AutoFormResult = { jobId: string; jobNumber: string; outcome: "created" | "held" | "uncertain" | "failed"; message?: string };

export async function sweepReadyCheckForms(opts: { call?: MittiCall; now?: Date; dryRun?: boolean } = {}) {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - AUTOFORM_WINDOW_DAYS * 86_400_000).toISOString();
  const { data: jobs, error } = await admin.from("jobs")
    .select("id, job_number, channel, source, stage, created_at, deleted_at, qa_archived_at, originating_installer_business_id")
    .eq("channel", "installer_sourced").is("deleted_at", null).is("qa_archived_at", null)
    .in("stage", [...PRE_READY_CHECK_STAGES]).gte("created_at", since).order("created_at").limit(500);
  if (error) throw new Error(`Ready Check form sweep could not read jobs: ${error.message}`);
  if (!jobs?.length) return { checked: 0, results: [] as AutoFormResult[], wouldCreate: [] as string[] };
  const ids = jobs.map((j) => j.id);
  const [ws, measurements, assignments, failures] = await Promise.all([
    admin.from("workflow_settings").select("auto_send_mitti, mitti_ready_check_priced_template_id").eq("id", 1).maybeSingle(),
    admin.from("ceiling_measurements").select("job_id").in("job_id", ids).eq("is_current", true),
    admin.from("job_assignments").select("job_id, user_id, business_id").in("job_id", ids).eq("role", "installer").eq("active", true),
    admin.from("workflow_events").select("job_id, created_at").in("job_id", ids).eq("event_type", AUTOFORM_FAILED_EVENT).order("created_at", { ascending: false }),
  ]);
  if (ws.error || measurements.error || assignments.error || failures.error) throw new Error("Ready Check form sweep could not read job facts.");
  const bizIds = [...new Set(jobs.map((j) => assignments.data?.find((a) => a.job_id === j.id)?.business_id ?? j.originating_installer_business_id).filter(Boolean) as string[])];
  const { data: businesses, error: be } = bizIds.length ? await admin.from("businesses").select("id, mitti_account_invited, onboarding_notes").in("id", bizIds) : { data: [], error: null };
  if (be) throw new Error("Ready Check form sweep could not read installers.");
  const measured = new Set((measurements.data ?? []).map((m) => m.job_id));
  const { isTestPartner } = await import("./test-send.core");

  const results: AutoFormResult[] = [];
  const wouldCreate: string[] = [];
  for (const j of jobs) {
    if (results.length >= AUTOFORM_MAX_PER_TICK) break;
    const asg = assignments.data?.find((a) => a.job_id === j.id) ?? null;
    const biz = businesses?.find((b) => b.id === (asg?.business_id ?? j.originating_installer_business_id)) ?? null;
    const d = autoFormDecision({
      channel: j.channel, stage: j.stage, createdAt: j.created_at, deleted: !!j.deleted_at, archived: !!j.qa_archived_at,
      hasCurrentMeasurement: measured.has(j.id), installerUserId: asg?.user_id ?? null,
      mittiInvited: biz?.mitti_account_invited === true, templateSet: !!ws.data?.mitti_ready_check_priced_template_id?.trim(),
      autoSendMitti: ws.data?.auto_send_mitti === true,
      lastFailureAt: failures.data?.find((f) => f.job_id === j.id)?.created_at ?? null,
    }, now);
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
      results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "created" });
    } catch (e) {
      if (e instanceof MittiClaimHeld) { results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "held" }); continue; }
      // Uncertain: createAssignMittiAudit already recorded an office flag and keeps the claim, so it never retries.
      if (e instanceof MittiOutcomeUncertain) { results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "uncertain" }); continue; }
      const message = e instanceof Error ? e.message : "Mitti error";
      await logEvent(j.id, null, AUTOFORM_FAILED_EVENT, `Mitti Ready Check form could not be created automatically: ${message}`.slice(0, 500), { needs_office: true, reason: message.slice(0, 300) }, { internal: true }).catch(() => undefined);
      results.push({ jobId: j.id, jobNumber: j.job_number, outcome: "failed", message });
    }
  }
  return { checked: jobs.length, results, wouldCreate };
}
