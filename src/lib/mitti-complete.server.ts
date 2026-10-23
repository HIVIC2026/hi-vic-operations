// Jo 24 Oct 2026: the installer marks the Mitti Ready Check Complete → with no office steps in between, the
// measurements are recorded, eligibility is decided from the form's answers, the job moves to the quote stage and
// the owner's quote goes out (A1 installer jobs and A2 our leads alike). Any failed check holds the job for the
// office with the reason (one note per situation). Switched off with AUTO_QUOTE_SEND_ENABLED until Jo says go.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent, transition, stageEntryBlockers, getStage } from "./workflow.server";
import { AUTO_QUOTE_SEND_ENABLED } from "./auto-quote-send.core";
import { completionPlan, type CompletionInput } from "./mitti-complete.core";

export type FinishResult = { done: "off" | "waiting" | "held" | "sent" | "stage_ready"; reasons: string[] };

export async function finishMittiReadyCheck(jobId: string, i: { auditId: string; completed: boolean; modifiedAt: string | null; entries: { label: string; value: unknown }[]; ourLead: boolean; enabled?: boolean }): Promise<FinishResult> {
  const enabled = i.enabled ?? AUTO_QUOTE_SEND_ENABLED;
  if (!enabled) return { done: "off", reasons: [] };
  if (!i.completed) return { done: "waiting", reasons: [] };
  const { held } = await import("./auto-quote-send.server");

  // 1. Measurements from the completed form (Mitti record for THIS form, not yet complete).
  const [{ data: m }, { data: job }] = await Promise.all([
    admin.from("ceiling_measurements").select("id, status, external_source, external_id, provenance, review_flags, measured_area_m2, insulation_present, existing_r_value, removal_required, removal_m2, access_difficulty, source_role").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("jobs").select("stage, channel, life_support_status, properties(enrichment)").eq("id", jobId).single(),
  ]);
  if (!job) return { done: "waiting", reasons: [] };
  const overFive = ((job.properties as { enrichment?: { base44?: { declared?: { over_five_years?: string } } } } | null)?.enrichment?.base44?.declared?.over_five_years) ?? null;
  const plan = completionPlan({ ...(i as CompletionInput), measurement: m as never, websiteFacts: i.ourLead ? { lifeSupportStatus: job.life_support_status as string | null, overFiveYears: overFive } : null });
  if (plan.kind === "skip") return { done: "waiting", reasons: [] };
  if (plan.kind === "hold") { await held(jobId, `complete:${i.auditId}:${i.modifiedAt}:${plan.reasons.join("|")}`, plan.reasons); return { done: "held", reasons: plan.reasons }; }

  if (plan.kind === "complete") {
    const now = new Date().toISOString();
    const { data: done, error } = await admin.from("ceiling_measurements").update({ status: "complete", completed_at: now, review_flags: [], ...plan.fill })
      .eq("id", m!.id).eq("is_current", true).neq("status", "complete").select("id").maybeSingle();
    if (error) throw new Error(`Ready Check measurements could not be completed: ${error.message}`);
    if (done) {
      await logEvent(jobId, null, "measurement_completed", `Ready Check marked Complete in Mitti — measurements recorded automatically (${Number(m!.measured_area_m2)} m²)`, { measurement_id: m!.id, audit_id: i.auditId, basis: "mitti_complete", filled: plan.fill }, { internal: true });
      const { FORM_ELIGIBLE_EVENT } = await import("./verified-eligibility.server");
      await logEvent(jobId, null, FORM_ELIGIBLE_EVENT, "Eligible from the Ready Check form answers (below R2.0, no previous VEU ceiling insulation, contact agreed)", { audit_id: i.auditId, modified_at: i.modifiedAt, basis: "mitti_form_answers", ruleset: "mitti-form-eligibility-v1" }, { internal: true });
    }
  }

  // 2. Stage: Ready Check → complete → quote stage (guarded; a refusal is held with its reasons).
  if ((job.channel === "installer_sourced")) { const { holdAtMittiReadyCheck } = await import("./mitti-pickup.server"); await holdAtMittiReadyCheck(jobId, null).catch(() => false); }
  for (const to of ["ready_check_complete", "measured_estimate_ready"] as const) {
    const stage = await getStage(jobId);
    if (stage === to || (to === "ready_check_complete" && stage !== "ready_check_scheduled")) continue;
    if (to === "measured_estimate_ready" && stage !== "ready_check_complete") continue;
    const blockers = await stageEntryBlockers(jobId, to);
    if (blockers.length) { await held(jobId, `stage:${to}:${blockers.join("|")}`, blockers); return { done: "held", reasons: blockers }; }
    await transition(jobId, to, null, to === "ready_check_complete" ? "Ready Check marked Complete in Mitti" : "Quote stage: Ready Check complete and eligible from the form answers", { audit_id: i.auditId });
  }

  // 3. The owner's quote.
  const { maybeAutoSendInstallerQuote } = await import("./auto-quote-send.server");
  const r = await maybeAutoSendInstallerQuote(jobId, { formCompleted: true, formModifiedAt: i.modifiedAt, enabled });
  return r.sent ? { done: "sent", reasons: [] } : { done: (await getStage(jobId)) === "measured_estimate_ready" ? "stage_ready" : "held", reasons: r.reasons };
}

/** Every tick: retry completed Mitti Ready Checks still short of a sent quote (after the office fixed a held reason),
 *  and watch forms whose quote went out for later edits (the regular sync stops reading a completed form). */
export async function sweepCompletedMittiReadyChecks(opts: { enabled?: boolean; limit?: number; call?: import("./mitti.core").MittiCall } = {}): Promise<{ retried: number; watched: number }> {
  const enabled = opts.enabled ?? AUTO_QUOTE_SEND_ENABLED;
  if (!enabled) return { retried: 0, watched: 0 };
  const { data: rows, error } = await admin.from("ceiling_measurements").select("job_id, external_id, completed_at, jobs!inner(stage, channel, deleted_at, qa_archived_at, business_unit)")
    .eq("is_current", true).eq("external_source", "mitti").eq("status", "complete").eq("jobs.business_unit", "hivic").is("jobs.deleted_at", null)
    .in("jobs.stage", ["ready_check_scheduled", "ready_check_complete", "measured_estimate_ready", "awaiting_quote_acceptance"]).order("completed_at", { ascending: false }).limit(opts.limit ?? 20);
  if (error) throw new Error(`Completed Ready Checks could not be read: ${error.message}`);
  let retried = 0, watched = 0;
  const { mittiApi } = await import("./mitti.core");
  const call = opts.call ?? (await import("./mitti.server")).realMittiCall;
  for (const r of rows ?? []) {
    const j = r.jobs as { stage: string; channel: string | null };
    const { count: auto } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", r.job_id).eq("event_type", "measurement_completed").contains("details", { audit_id: r.external_id, basis: "mitti_complete" });
    if (!auto) continue; // only Ready Checks this automation completed
    let modifiedAt: string | null = null;
    try { const a = await mittiApi(call).getAudit(String(r.external_id)); modifiedAt = a?.modified_at ?? a?.audit_data?.date_modified ?? null; watched++; } catch { /* Mitti unavailable: retry next tick */ }
    if (j.stage === "awaiting_quote_acceptance") {
      const { maybeAutoSendInstallerQuote } = await import("./auto-quote-send.server");
      await maybeAutoSendInstallerQuote(r.job_id, { formCompleted: true, formModifiedAt: modifiedAt, enabled }).catch(() => undefined);
      continue;
    }
    await finishMittiReadyCheck(r.job_id, { auditId: String(r.external_id), completed: true, modifiedAt, entries: [], ourLead: j.channel !== "installer_sourced", enabled }).catch(() => undefined);
    retried++;
  }
  return { retried, watched };
}
