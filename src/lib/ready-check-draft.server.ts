// Durable portal Ready Check draft: ready_checks (status 'draft') + ready_check_observations — the canonical tables.
// Server-only; callers authorise first. Saving never submits, completes, verifies or signs anything.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { RC_DRAFT_FIELDS, fromObservations, knownPrefill, rcProgress, toObservations, type RcDraftValues, type RcEvidence } from "./ready-check-draft.core";
import type { Observations } from "./readycheck.core";

async function latestRc(jobId: string) {
  const { data, error } = await admin.from("ready_checks").select("id, version, status, submitted_at, updated_at, external_mitti_id").eq("job_id", jobId).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError(error.message);
  return data;
}

async function observations(rcId: string): Promise<Observations> {
  const { data, error } = await admin.from("ready_check_observations").select("field_key, value").eq("ready_check_id", rcId);
  if (error) throw new WorkflowError(error.message);
  const o: Observations = {};
  for (const r of data ?? []) o[r.field_key] = (r.value as string | number | boolean | null) ?? null;
  return o;
}

async function rcEvidence(jobId: string): Promise<RcEvidence[]> {
  const { data, error } = await admin.from("evidence_requirements").select("label, gate, required, status, category").eq("job_id", jobId).order("sort");
  if (error) throw new WorkflowError(error.message);
  return (data ?? []) as RcEvidence[];
}

/** Current draft/submission + exact missing/rejected/awaiting items. Prefills only EMPTY answers from known facts. */
export async function loadRcDraft(jobId: string) {
  const rc = await latestRc(jobId);
  const obs = rc ? await observations(rc.id) : {};
  const { installerIntakeState } = await import("./installer-intake.server");
  const st = await installerIntakeState(jobId);
  const values = fromObservations(obs);
  const pre = knownPrefill({ insulation: st.insulation });
  const prefilled: string[] = [];
  for (const [k, v] of Object.entries(pre)) if (!values[k]) { values[k] = v; prefilled.push(k); }
  const progress = rcProgress(obs, await rcEvidence(jobId));
  return {
    readyCheckId: rc?.id ?? null, status: (rc?.status ?? "none") as "none" | "draft" | "submitted", savedAt: rc?.updated_at ?? null,
    values, prefilled, suppliedAreaHint: st.areaProvenance === "installer_provisional" ? st.areaM2 : null,
    progress, coordination: st.coordination, commercial: { ready: st.readiness.ready, blockers: st.readiness.blockers, releaseBlockers: st.releaseBlockers },
  };
}

/** Partial save. Blank = unknown (row removed). A submitted Ready Check is never edited here. Idempotent per field. */
export async function saveRcDraft(jobId: string, userId: string, businessId: string, values: RcDraftValues) {
  const { obs, problems } = toObservations(values);
  if (problems.length) throw new WorkflowError(problems.join(" • "));
  let rc = await latestRc(jobId);
  if (rc?.status === "submitted") throw new WorkflowError("This Ready Check was already submitted — ask Home Insulation Victoria to reopen it.");
  if (!rc) {
    const { data, error } = await admin.from("ready_checks").insert({ job_id: jobId, version: 1, status: "draft", installer_user_id: userId, installer_business_id: businessId }).select("id, version, status, submitted_at, updated_at, external_mitti_id").single();
    if (error) { // parallel first save: reuse the row the other tab created
      if (!/duplicate|unique/i.test(error.message)) throw new WorkflowError(error.message);
      rc = await latestRc(jobId);
      if (!rc) throw new WorkflowError(error.message);
    } else rc = data;
  }
  const set = RC_DRAFT_FIELDS.filter((f) => obs[f.key] != null).map((f) => ({ ready_check_id: rc!.id, job_id: jobId, field_key: f.key, value: obs[f.key] as unknown as Json, recorded_by: userId, recorded_at: new Date().toISOString() }));
  const cleared = RC_DRAFT_FIELDS.filter((f) => obs[f.key] == null).map((f) => f.key);
  if (set.length) { const { error } = await admin.from("ready_check_observations").upsert(set, { onConflict: "ready_check_id,field_key" }); if (error) throw new WorkflowError(error.message); }
  if (cleared.length) { const { error } = await admin.from("ready_check_observations").delete().eq("ready_check_id", rc.id).in("field_key", cleared); if (error) throw new WorkflowError(error.message); }
  const { error: ue } = await admin.from("ready_checks").update({ updated_at: new Date().toISOString() }).eq("id", rc.id).eq("status", "draft");
  if (ue) throw new WorkflowError(ue.message);
  await logEvent(jobId, userId, "ready_check_draft_saved", `Ready Check draft saved (${set.length} answer${set.length === 1 ? "" : "s"}) — not submitted`, { ready_check_id: rc.id, answered: set.map((s) => s.field_key) }, { internal: true });
  return loadRcDraft(jobId);
}

/** Original-condition answers still missing for an installer-intake job (feeds the existing pre-start works lock). */
export async function rcWorksBlockers(jobId: string): Promise<string[]> {
  const { isIntakeJob } = await import("./installer-intake.server");
  if (!(await isIntakeJob(jobId))) return [];
  const rc = await latestRc(jobId);
  return rcProgress(rc ? await observations(rc.id) : {}, []).worksBlockers;
}

/** The canonical Ready Check answer for existing insulation (latest non-superseded Ready Check), or null if not recorded. */
export async function rcObservedInsulation(jobId: string): Promise<string | null> {
  const rc = await latestRc(jobId);
  if (!rc) return null;
  const v = (await observations(rc.id))["insulation.existing"];
  return typeof v === "string" ? v : null;
}
