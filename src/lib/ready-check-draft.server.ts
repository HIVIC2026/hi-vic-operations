// Durable portal Ready Check draft: ready_checks (status 'draft') + ready_check_observations — the canonical tables.
// Server-only; callers authorise first. Saving never submits, completes, verifies or signs anything.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { RC_DRAFT_FIELDS, fromObservations, knownPrefill, rcProgress, rcSubmitBlockers, toObservations, type RcDraftValues, type RcEvidence } from "./ready-check-draft.core";
import type { Observations } from "./readycheck.core";
import { AREAS_FIELD_KEY, AREA_EVIDENCE_SORT, areaEvidenceSpecs, areaProblems, areaTasks, areaWorksBlockers, attribute, carryForward, readAreas, totals, type AreaReq, type RcArea } from "./ready-check-areas.core";

async function latestRc(jobId: string) {
  const { data, error } = await admin.from("ready_checks").select("id, version, status, submitted_at, updated_at, external_mitti_id").eq("job_id", jobId).neq("status", "superseded").order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError(error.message);
  return data;
}

/**
 * Authoritative Ready Check state for a job, or null when nothing has been recorded yet.
 * `fromMitti` marks a row the Mitti form owns: the portal draft must never edit or submit it.
 * (Brief O, 43dfc9fb; restored after the bdf1da3c reconcile silently dropped it.)
 */
export async function readyCheckState(jobId: string) {
  const rc = await latestRc(jobId);
  if (!rc) return null;
  return { status: rc.status as "draft" | "submitted", submittedAt: rc.submitted_at as string | null, fromMitti: !!rc.external_mitti_id };
}

async function observations(rcId: string): Promise<Observations> {
  const { data, error } = await admin.from("ready_check_observations").select("field_key, value").eq("ready_check_id", rcId);
  if (error) throw new WorkflowError(error.message);
  const o: Observations = {};
  for (const r of data ?? []) if (r.field_key !== AREAS_FIELD_KEY) o[r.field_key] = (r.value as string | number | boolean | null) ?? null;
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
  const saved = rc ? await savedAreas(rc.id) : null;
  const suggested = saved ? [] : await suggestedAreas(jobId, st);
  const areas = saved ?? [];
  const reqs = areas.length ? await areaReqs(jobId) : []; // area_key read only once areas exist (pending 0214)
  return {
    areas, areasSaved: saved != null, suggestedAreas: suggested, preliminaryOnly: st.attended !== "yes",
    areaTotals: totals(areas), areaTasks: areaTasks(areas, reqs), areaWorksBlockers: areaWorksBlockers(areas, reqs),
    areaEvidence: reqs.filter((r) => areas.some((a) => a.key === r.area_key)), supportingFiles: await supportingFiles(jobId),
    readyCheckId: rc?.id ?? null, status: (rc?.status ?? "none") as "none" | "draft" | "submitted", savedAt: rc?.updated_at ?? null,
    // A Mitti-owned row is read-only here: the portal must never write to a form Mitti owns.
    fromMitti: !!rc?.external_mitti_id,
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
  // A form Mitti owns stays Mitti's: writing observations onto that row would corrupt its sync.
  if (rc?.external_mitti_id) throw new WorkflowError("This Ready Check came from Mitti — complete or correct it there.");
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

/** P1: explicit installer "Submit for review". draft -> submitted (+ submitted_at) on the existing ready_checks row
 *  (schema 0043 already defines 'submitted'; office views already read submitted_at). Only when every required
 *  answer and assessment-gate evidence item is entered. Compare-and-set on status; a repeat submit is a no-op.
 *  Does NOT change the job stage, verify eligibility, create quotes or send anything. */
export async function submitRcDraft(jobId: string, userId: string) {
  const rc = await latestRc(jobId);
  if (!rc) throw new WorkflowError("Save the Ready Check before submitting it.");
  if (rc.status === "submitted") return loadRcDraft(jobId);
  if (rc.external_mitti_id) throw new WorkflowError("This Ready Check came from Mitti — submit it there.");
  const blockers = rcSubmitBlockers(rcProgress(await observations(rc.id), await rcEvidence(jobId)));
  if (blockers.length) throw new WorkflowError(`Not ready to submit: ${blockers.join(" • ")}`);
  const now = new Date().toISOString();
  const { data, error } = await admin.from("ready_checks").update({ status: "submitted", submitted_at: now, updated_at: now }).eq("id", rc.id).eq("status", "draft").select("id");
  if (error) throw new WorkflowError(error.message);
  if (!data?.length) { const again = await latestRc(jobId); if (again?.status === "submitted") return loadRcDraft(jobId); throw new WorkflowError("The Ready Check changed while submitting — reload and try again."); }
  await logEvent(jobId, userId, "ready_check_submitted", "Ready Check submitted by the installer for Home Insulation Victoria review", { ready_check_id: rc.id, version: rc.version }, { internal: true });
  return loadRcDraft(jobId);
}

/** Office-only: reopen a SUBMITTED portal Ready Check so the installer can correct answers (the saved error message
 *  already tells installers to ask for this). submitted -> draft only if still submitted; refused while a current
 *  "eligible" verification relies on it (record "needs review" first). Never moves the job or sends anything. */
export async function reopenRcDraft(jobId: string, actorId: string, reason: string) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const rc = await latestRc(jobId);
  if (!rc || rc.status !== "submitted") throw new WorkflowError("There is no submitted Ready Check to reopen.");
  if (rc.external_mitti_id) throw new WorkflowError("This Ready Check came from Mitti — correct it there.");
  const { verifiedEligible } = await import("./verified-eligibility.server");
  if (await verifiedEligible(jobId)) throw new WorkflowError("Eligibility is recorded as verified on this Ready Check. Record \"Needs office review\" first, then reopen it.");
  const { data, error } = await admin.from("ready_checks").update({ status: "draft", submitted_at: null, updated_at: new Date().toISOString() }).eq("id", rc.id).eq("status", "submitted").select("id");
  if (error) throw new WorkflowError(error.message);
  if (!data?.length) throw new WorkflowError("The Ready Check changed — reload and try again.");
  await logEvent(jobId, actorId, "ready_check_reopened", `Ready Check reopened for the installer to correct: ${reason.trim()}`, { ready_check_id: rc.id, version: rc.version }, { internal: true });
  return { ok: true as const };
}

/** Original-condition answers still missing for an installer-intake job (feeds the existing pre-start works lock). */
export async function rcWorksBlockers(jobId: string): Promise<string[]> {
  const { isIntakeJob } = await import("./installer-intake.server");
  if (!(await isIntakeJob(jobId))) return [];
  const rc = await latestRc(jobId);
  return [...rcProgress(rc ? await observations(rc.id) : {}, []).worksBlockers, ...(rc ? await rcAreaWorksBlockers(jobId) : [])];
}

/** The canonical Ready Check answer for existing insulation (latest non-superseded Ready Check), or null if not recorded. */
export async function rcObservedInsulation(jobId: string): Promise<string | null> {
  const rc = await latestRc(jobId);
  if (!rc) return null;
  const v = (await observations(rc.id))["insulation.existing"];
  return typeof v === "string" ? v : null;
}

// ---------------- Ceiling areas (canonical Ready Check observation + area-tagged evidence_requirements) ----------------

async function savedAreas(rcId: string): Promise<RcArea[] | null> {
  const { data, error } = await admin.from("ready_check_observations").select("value").eq("ready_check_id", rcId).eq("field_key", AREAS_FIELD_KEY).maybeSingle();
  if (error) throw new WorkflowError(error.message);
  return data ? readAreas(data.value) : null; // malformed -> throws (fail closed)
}

/** Area-tagged requirements. Read failure throws: never shown as "nothing missing". */
async function areaReqs(jobId: string): Promise<AreaReq[]> {
  const { data, error } = await admin.from("evidence_requirements").select("id, area_key, category, gate, status, label").eq("job_id", jobId).not("area_key", "is", null);
  if (error) throw new WorkflowError(/area_key/.test(error.message) ? "Per-area evidence needs the pending database update (0214) — not applied yet." : error.message);
  return (data ?? []) as unknown as AreaReq[];
}

async function supportingFiles(jobId: string) {
  const { data, error } = await admin.from("documents").select("id, title, uploaded_by, created_at").eq("job_id", jobId).eq("kind", "installer_import").order("created_at");
  if (error) throw new WorkflowError(error.message);
  return (data ?? []).map((d) => ({ id: d.id as string, title: d.title as string, uploadedBy: d.uploaded_by as string | null, uploadedAt: d.created_at as string, accepted: false as const }));
}

/** Attended installers only: their saved facts, each labelled with who supplied it and when. Never saved automatically. */
async function suggestedAreas(jobId: string, st: { attended: "yes" | "no" | null; areaM2: number | null; insulation: "none" | "below_r2" | "unknown" | null; proposedR?: number | null; includes?: string | null }) {
  if (st.attended !== "yes") return [];
  const { data: m, error } = await admin.from("ceiling_measurements").select("removal_required, removal_m2, supplied_removal_m2, created_by, created_at").eq("job_id", jobId).eq("is_current", true).limit(1).maybeSingle();
  if (error) throw new WorkflowError(error.message);
  const rm = m?.supplied_removal_m2 ?? m?.removal_m2 ?? null;
  return carryForward({ attended: st.attended, areaM2: st.areaM2, insulation: st.insulation, removalRequired: m?.removal_required ?? null, removalM2: rm == null ? null : Number(rm),
    product: st.proposedR == null ? null : `R${st.proposedR}`, scope: st.includes ?? null, suppliedBy: (m?.created_by as string | null) ?? null, suppliedAt: (m?.created_at as string | null) ?? null });
}

/** Create any missing per-area evidence rows. Idempotent (retry/double-click) via the (job, category, area) unique index. */
async function ensureAreaReqs(jobId: string, areas: RcArea[]) {
  const have = await areaReqs(jobId);
  const want = areas.flatMap(areaEvidenceSpecs).filter((w) => !have.some((h) => h.area_key === w.area_key && h.category === w.category));
  for (const w of want) {
    const { error } = await admin.from("evidence_requirements").insert({ job_id: jobId, category: w.category as never, label: w.label, gate: w.gate, required: true, status: "outstanding", responsible_role: "installer" as never, sort: AREA_EVIDENCE_SORT, area_key: w.area_key } as never);
    if (error && !/duplicate|unique/i.test(error.message)) throw new WorkflowError(/area_key/.test(error.message) ? "Per-area evidence needs the pending database update (0214) — not applied yet." : error.message);
  }
  // Areas removed from the draft: untouched outstanding rows stop being required; rows with files or reviews are kept.
  for (const h of have.filter((h) => !areas.some((a) => a.key === h.area_key) && h.status === "outstanding")) {
    const { error } = await admin.from("evidence_requirements").update({ required: false, status: "not_required" } as never).eq("id", h.id).eq("status", "outstanding");
    if (error) throw new WorkflowError(error.message);
  }
}

/** Save the ceiling areas on the current DRAFT Ready Check. Submitted / Mitti-owned rows are never rewritten. */
export async function saveRcAreas(jobId: string, userId: string, businessId: string, input: RcArea[]) {
  let rc = await latestRc(jobId);
  if (rc?.status === "submitted") throw new WorkflowError("This Ready Check was already submitted — start a dated correction instead of changing it.");
  if (rc?.external_mitti_id) throw new WorkflowError("This Ready Check came from Mitti — complete or correct it there.");
  const obs = rc ? await observations(rc.id) : {};
  const total = typeof obs["measure.eligible_area_m2"] === "number" ? (obs["measure.eligible_area_m2"] as number) : null;
  const problems = areaProblems(input, total);
  if (problems.length) throw new WorkflowError(problems.join(" • "));
  const { installerIntakeState } = await import("./installer-intake.server");
  const st = await installerIntakeState(jobId);
  // Not attended: no carry-forward exists, so every saved fact is attributed to the person recording it now.
  if (!rc) {
    const { data, error } = await admin.from("ready_checks").insert({ job_id: jobId, version: 1, status: "draft", installer_user_id: userId, installer_business_id: businessId }).select("id, version, status, submitted_at, updated_at, external_mitti_id").single();
    if (error) { if (!/duplicate|unique/i.test(error.message)) throw new WorkflowError(error.message); rc = await latestRc(jobId); if (!rc) throw new WorkflowError(error.message); }
    else rc = data;
  }
  const prev = (await savedAreas(rc.id)) ?? [];
  const suggested = await suggestedAreas(jobId, st);
  const now = new Date().toISOString();
  const areas = attribute(prev, suggested, input, userId, now);
  const { error } = await admin.from("ready_check_observations").upsert({ ready_check_id: rc.id, job_id: jobId, field_key: AREAS_FIELD_KEY, value: { areas } as unknown as Json, recorded_by: userId, recorded_at: now }, { onConflict: "ready_check_id,field_key" });
  if (error) throw new WorkflowError(error.message);
  await ensureAreaReqs(jobId, areas);
  const { error: ue } = await admin.from("ready_checks").update({ updated_at: now }).eq("id", rc.id).eq("status", "draft");
  if (ue) throw new WorkflowError(ue.message);
  await logEvent(jobId, userId, "ready_check_areas_saved", `Ready Check ceiling areas saved (${areas.length}) — not submitted, nothing accepted`, { ready_check_id: rc.id, areas: areas.map((a) => a.key) }, { internal: true });
  return loadRcDraft(jobId);
}

/** Dated correction of a SUBMITTED portal Ready Check: a new draft version copying the answers (original recorder/time
 *  kept). The submitted version is never rewritten or backdated. Idempotent: an open correction is reused. */
export async function startRcCorrection(jobId: string, userId: string, reason: string) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const rc = await latestRc(jobId);
  if (!rc) throw new WorkflowError("There is no Ready Check to correct.");
  if (rc.status === "draft") return loadRcDraft(jobId); // already correcting / still a draft
  if (rc.external_mitti_id) throw new WorkflowError("This Ready Check came from Mitti — correct it there.");
  const { data: rows, error: re } = await admin.from("ready_check_observations").select("field_key, value, recorded_by, recorded_at").eq("ready_check_id", rc.id);
  if (re) throw new WorkflowError(re.message);
  const { data: nv, error } = await admin.from("ready_checks").insert({ job_id: jobId, version: rc.version + 1, status: "draft", installer_user_id: userId }).select("id").single();
  if (error) { if (/duplicate|unique/i.test(error.message)) return loadRcDraft(jobId); throw new WorkflowError(error.message); }
  if (rows?.length) {
    const { error: ce } = await admin.from("ready_check_observations").insert(rows.map((r) => ({ ready_check_id: nv.id, job_id: jobId, field_key: r.field_key, value: r.value, recorded_by: r.recorded_by, recorded_at: r.recorded_at })));
    if (ce) throw new WorkflowError(ce.message);
  }
  await logEvent(jobId, userId, "ready_check_correction_started", `Ready Check correction started (version ${rc.version + 1}): ${reason.trim()} — version ${rc.version} kept unchanged`, { from_ready_check_id: rc.id, ready_check_id: nv.id, version: rc.version + 1 }, { internal: true });
  return loadRcDraft(jobId);
}

/** Per-area original-condition hold (removal/disturbance/covering). Read failures throw (fail closed). */
export async function rcAreaWorksBlockers(jobId: string): Promise<string[]> {
  const rc = await latestRc(jobId);
  if (!rc) return [];
  const areas = await savedAreas(rc.id);
  if (!areas?.length) return [];
  return areaWorksBlockers(areas, await areaReqs(jobId));
}
