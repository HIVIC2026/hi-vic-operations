// Jo 24 Oct 2026: the installer marks the Mitti Ready Check Complete → with no office steps in between, the
// measurements are recorded, eligibility is decided from the form's answers, the job moves to the quote stage and
// the owner's quote goes out (A1 installer jobs and A2 our leads alike). Any failed check holds the job for the
// office with the reason (one note per situation). Jo 24 Oct: preparation runs (READY_CHECK_AUTO_PREP_ENABLED); the send
// itself stays with the office for the first few weeks (AUTO_QUOTE_SEND_ENABLED off → quote waits on Quotes to check).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent, transition, stageEntryBlockers, getStage } from "./workflow.server";
import { AUTO_QUOTE_SEND_ENABLED, READY_CHECK_AUTO_PREP_ENABLED } from "./auto-quote-send.core";
import { completionPlan, type CompletionInput } from "./mitti-complete.core";

export type FinishResult = { done: "off" | "waiting" | "held" | "sent" | "stage_ready"; reasons: string[] };

export async function finishMittiReadyCheck(jobId: string, i: { auditId: string; completed: boolean; modifiedAt: string | null; entries: { label: string; value: unknown }[]; ourLead: boolean; enabled?: boolean; sendEnabled?: boolean }): Promise<FinishResult> {
  const enabled = i.enabled ?? READY_CHECK_AUTO_PREP_ENABLED;
  const sendEnabled = i.sendEnabled ?? AUTO_QUOTE_SEND_ENABLED;
  if (!enabled) return { done: "off", reasons: [] };
  if (!i.completed) return { done: "waiting", reasons: [] };
  // Decision 288 (Jo 25 Oct 2026): an A1 Ready Check marked Complete with no price yet → the business owner is texted ONE
  // link to the "Your price" card (whoever pressed Complete). Once per job; never once the price is in; never blocks.
  if (!i.ourLead) await (await import("./boss-price-link.server")).textBossPriceLink(jobId, { auditId: i.auditId, completedAt: i.modifiedAt, entries: i.entries });
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
      await logEvent(jobId, null, FORM_ELIGIBLE_EVENT, "Eligible from the Ready Check form answers (below R2.0, owner agreed to be contacted)", { audit_id: i.auditId, modified_at: i.modifiedAt, basis: "mitti_form_answers", ruleset: "mitti-form-eligibility-v1" }, { internal: true });
    }
  }

  // 1b. Decision 211: the Table 4 upgrade area diagram, drawn from the completed form's areas (idempotent per facts; never blocks).
  if (plan.kind === "complete" || plan.kind === "already") {
    const { fileReadyCheckAreaDiagram } = await import("./area-diagram.server");
    await fileReadyCheckAreaDiagram(jobId, null, { entries: i.entries, auditId: i.auditId });
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
  const r = await maybeAutoSendInstallerQuote(jobId, { formCompleted: true, formModifiedAt: i.modifiedAt, enabled: sendEnabled, entries: i.entries });
  return r.sent ? { done: "sent", reasons: [] } : { done: (await getStage(jobId)) === "measured_estimate_ready" ? "stage_ready" : "held", reasons: r.reasons };
}

/** Every tick: retry completed Mitti Ready Checks still short of a sent quote (after the office fixed a held reason),
 *  and watch forms whose quote went out for later edits (the regular sync stops reading a completed form). */
export async function sweepCompletedMittiReadyChecks(opts: { enabled?: boolean; sendEnabled?: boolean; limit?: number; call?: import("./mitti.core").MittiCall; budgetMs?: number } = {}): Promise<{ retried: number; watched: number }> {
  const enabled = opts.enabled ?? READY_CHECK_AUTO_PREP_ENABLED;
  const sendEnabled = opts.sendEnabled ?? AUTO_QUOTE_SEND_ENABLED;
  if (!enabled) return { retried: 0, watched: 0 };
  const { runStoredMittiPull, recordMittiPullOutcome } = await import("./mitti-pull-progress.server");
  let retried = 0, watched = 0;
  const { mittiApi, parseAudit } = await import("./mitti.core");
  const call = opts.call ?? (await import("./mitti.server")).realMittiCall;
  await runStoredMittiPull("completed", {
    page: async (offset, size) => {
      const { data, error } = await admin.from("ceiling_measurements").select("job_id, external_id, completed_at, jobs!inner(stage, channel, deleted_at, qa_archived_at, business_unit)")
        .eq("is_current", true).eq("external_source", "mitti").eq("status", "complete").eq("jobs.business_unit", "hivic").is("jobs.deleted_at", null).is("jobs.qa_archived_at", null)
        .in("jobs.stage", ["ready_check_scheduled", "ready_check_complete", "measured_estimate_ready", "awaiting_quote_acceptance"]).order("job_id").range(offset, offset + size - 1);
      if (error) throw new Error(`Completed Ready Checks could not be read: ${error.message}`);
      return (data ?? []).map(r => ({ ...r, id: r.job_id }));
    },
    sync: async r => {
    const j = r.jobs as { stage: string; channel: string | null };
    const { count: auto } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", r.job_id).eq("event_type", "measurement_completed").contains("details", { audit_id: r.external_id, basis: "mitti_complete" });
    if (!auto) return { ok: true }; // only Ready Checks this automation completed
    let modifiedAt: string | null = null;
    let entries: { label: string; value: string | null }[] = [];
    let changed = false;
    try {
      const a = await mittiApi(call).getAudit(String(r.external_id));
      const { refreshCompletedReadyCheck } = await import("./mitti-completed-refresh.server");
      changed = await refreshCompletedReadyCheck(r.job_id, String(r.external_id), a);
      modifiedAt = a?.modified_at ?? a?.audit_data?.date_modified ?? null; entries = parseAudit(a).snapshot; watched++;
    } catch (error) { throw error; /* No validated refresh: report failure, never draft stale facts. */ }
    // Decision 113 (Jo 24 Oct): a quote held at Complete (e.g. "My usual electrician" with none saved yet) simply waits.
    // The regular sync stops reading a completed form, so once the missing details are in (usual electrician saved in
    // My business, or the form changed to our electrician) this tick prepares the installer's draft from the form.
    if (j.channel === "installer_sourced" && entries.length && j.stage !== "awaiting_quote_acceptance") {
      const { completedDraftAllowed } = await import("./mitti-completed-refresh.server");
      // The draft helper deduplicates unchanged scope. Retrying held drafts also repairs a refresh whose
      // subsequent draft attempt was interrupted, without touching issued/accepted quotes.
      if (await completedDraftAllowed(r.job_id)) await (await import("./installer-quote.server")).draftInstallerQuoteFromReadyCheck(r.job_id, null, entries, String(r.external_id));
    } else if (changed && entries.length && j.channel !== "installer_sourced" && await (await import("./mitti-completed-refresh.server")).completedDraftAllowed(r.job_id)) {
      await (await import("./insulation-product.server")).mittiProductForJob(r.job_id, null, entries, String(r.external_id));
      await (await import("./ready-check-quote.server")).draftHivReadyCheckQuote(r.job_id, null, String(r.external_id), modifiedAt, entries);
    }
    if (j.stage === "awaiting_quote_acceptance") {
      const { maybeAutoSendInstallerQuote } = await import("./auto-quote-send.server");
      await maybeAutoSendInstallerQuote(r.job_id, { formCompleted: true, formModifiedAt: modifiedAt, enabled: sendEnabled, entries: entries.length ? entries : undefined });
      await recordMittiPullOutcome(r.job_id, "completed", true, "synced");
      return { ok: true };
    }
    await finishMittiReadyCheck(r.job_id, { auditId: String(r.external_id), completed: true, modifiedAt, entries, ourLead: j.channel !== "installer_sourced", enabled, sendEnabled });
    retried++;
    await recordMittiPullOutcome(r.job_id, "completed", true, "synced");
    return { ok: true };
    },
  }, opts.budgetMs ?? 40_000);
  return { retried, watched };
}
