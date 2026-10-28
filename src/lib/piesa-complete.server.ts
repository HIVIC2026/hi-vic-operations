// Complete PIESA (the electrician's "Complete PIESA" on the job page): every completion check, then the PIESA record, the
// official PIESA signed copy (decision 350) and the guarded move to PIESA complete. Moved verbatim from the `completeAssessment`
// server function, which still checks the caller (admin or the job's electrician, allowed to record clearance) before calling
// this; the live full-journey runner (TEST jobs) completes the TEST electrician's PIESA through the same path.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent, stageEntryBlockers, transition, getStage } from "./workflow.server";
import { STAGE_LABEL } from "./workflow";
import { piesaDateBlockers } from "./piesa-date.core";
import { autoAdvanceJob } from "./autoadvance.server";

export type CompletePiesaInput = { jobId: string; rectHours?: number | undefined; rectWindows?: { date: string; slot: "8-10" | "10-12" | "12-14" | "14-16" }[] | undefined };

/** The caller must already be checked (admin, or the assigned electrician allowed to record clearance). */
export async function completePiesaAssessment(data: CompletePiesaInput, userId: string) {
  const { data: a } = await admin.from("assessments").select("*").eq("job_id", data.jobId).maybeSingle();
  if (!a) throw new WorkflowError("Start the assessment first.");
  if (a.status === "complete") throw new WorkflowError("Electrical assessment is already complete.");
  const { jobScope, advanceSiteRequirements } = await import("./requirements.server");
  const s = await jobScope(data.jobId);
  const missing: string[] = [];
  // Night test run 25 Oct 2026: the live A3 (decisions 294–338) asks about the mains / safety switches as ONE Yes/No
  // question and has no separate switchboard-condition or RCD-present question, so a synced live A3 never fills those
  // two legacy fields — requiring them refused Complete PIESA on every live A3. They are still required for the manual
  // portal entry and older forms. The A3's own answers, evidence and the official-form checks are gated below/elsewhere.
  const { isLiveA3Snapshot, shortAnswersFromEntries: shortFrom } = await import("./official-short.core");
  const liveA3 = !!a.external_mitti_id && isLiveA3Snapshot(a.mitti_raw_snapshot);
  if (!a.switchboard_condition && !liveA3) missing.push("switchboard condition");
  if (a.rcds_present == null && !liveA3) missing.push("RCDs present");
  if (a.life_support_confirmed == null) missing.push("life support confirmation");
  if (a.piesa_outcome === "pending") missing.push("PIESA outcome");
  if (!a.assessed_on) missing.push("assessment date");
  if (missing.length) throw new WorkflowError(`Still needed: ${missing.join(", ")}`);
  // Decision 178: a Mitti PIESA cannot be completed until its evidence (switchboard + on-site photos geotagged,
  // a photo per hazard, the CES after fixes) is on the synced form. Same pure rule as the sync and the stage gate.
  if (a.external_mitti_id) {
    const { piesaEvidenceBlockersFromSnapshot } = await import("./piesa-evidence.core");
    const { shortAnswersFromEntries } = await import("./official-short.core");
    const evb = piesaEvidenceBlockersFromSnapshot(a.mitti_raw_snapshot, (entries) => shortAnswersFromEntries("piesa", entries));
    if (evb.length) throw new WorkflowError(`PIESA evidence still needed on the Mitti form: ${evb.join("; ")}`);
  }
  // Defence in depth: even a value written before this guard existed cannot be completed with a future date.
  const dateBlockers = piesaDateBlockers(a.assessed_on);
  if (dateBlockers.length) throw new WorkflowError(dateBlockers[0]!);
  const { data: ev } = await admin.from("evidence_requirements").select("label,status,gate,category").eq("job_id", data.jobId).eq("required", true);
  const evMissing = (ev ?? [])
    .filter((e) => a.piesa_outcome === "pass" && e.category === "piesa_signoff")
    .filter((e) => !["uploaded", "verified"].includes(e.status)).map((e) => e.label);
  if (evMissing.length) throw new WorkflowError(`Upload evidence first: ${evMissing.join(", ")}`);
  const { data: unpriced } = await admin.from("rectification_items").select("description").eq("job_id", data.jobId).eq("status", "required").eq("needs_office_pricing", true);
  if (unpriced?.length) throw new WorkflowError(`Home Insulation Victoria must price these items first: ${unpriced.map((u) => u.description).join(", ")}`);
  // Same-day rule: the PIESA submission must carry the rectification decision – priced items, or an explicit "none required".
  const { count: rectCount } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("status", "required");
  // A live A3 that says repair work is needed carries the electrician's own priced repair list (decisions 305/324):
  // that IS today's fixes quote (generated from the A3 after completion, decision 354), so no portal items are needed.
  const a3Priced = liveA3 && a.piesa_outcome === "fail" && (await import("./fixes-price.core")).fixesPriceSource(shortFrom("piesa", (a.mitti_raw_snapshot as { label: string; value: string | null }[] | null) ?? [])).path === "a4_price";
  if (!rectCount && a.no_rectification_confirmed !== true && !a3Priced) throw new WorkflowError("Add the electrical fixes items for today's quote, or tick \"No electrical fixes required\", before completing the PIESA.");
  if (rectCount && a.no_rectification_confirmed === true) throw new WorkflowError("You ticked \"No electrical fixes required\" but electrical fixes items are listed – untick it or remove the items.");

  // Rectification needed: the electrician also gives estimated hours + 3-5 windows (asked once, here) — unless they were
  // already given on the job page's "Fixes times" card (decision 315), which writes the same rows and event.
  const timesAlreadyGiven = rectCount ? await (await import("./rectification.server")).rectificationWindowsExist(data.jobId) : false;
  if (rectCount && !timesAlreadyGiven) {
    const { rectPlanBlockers } = await import("./rectification.core");
    const rb = rectPlanBlockers(data.rectHours, data.rectWindows ?? []);
    if (rb.length) throw new WorkflowError(`Electrical fixes times: ${rb.join(" ")}`);
  }
  const stage = await getStage(data.jobId);
  // Current model: the PIESA is booked at piesa_scheduled. assessment_booked is the retired legacy stage, kept for old jobs.
  if (stage !== "assessment_booked" && stage !== "piesa_scheduled") throw new WorkflowError(`The PIESA can be completed once it is booked (current: ${STAGE_LABEL[stage]}).`);
  if (stage === "piesa_scheduled") {
    // Check the guarded stage move BEFORE writing anything, so a blocked completion leaves no half-recorded PIESA.
    const entry = await stageEntryBlockers(data.jobId, "piesa_complete", userId);
    if (entry.length) throw new WorkflowError(`PIESA cannot be completed yet: ${entry.join(" ")}`);
  }
  const now = new Date().toISOString();
  await admin.from("assessments").update({ status: "complete", completed_at: now, assessor_id: a.assessor_id ?? userId, mitti_sync_status: a.external_mitti_id ? "synced" : "not_synced" }).eq("id", a.id);
  await admin.from("piesa_records").update({ is_current: false }).eq("job_id", data.jobId).eq("is_current", true);
  await admin.from("piesa_records").insert({ job_id: data.jobId, assessment_id: a.id, kind: "initial", outcome: a.piesa_outcome, completed_date: a.assessed_on!, signed_off_by: userId, external_mitti_id: a.external_mitti_id });
  // The safety check visit is done: mark the confirmed assessment booking completed so the electrician's pay line shows in the
  // office Payouts (office-money lists it only for a completed assessment booking). Same as piesa-record.server does for fixes.
  const { error: visitErr } = await admin.from("bookings").update({ status: "completed" }).eq("job_id", data.jobId).eq("kind", "assessment").eq("status", "confirmed");
  if (visitErr) console.error("safety check visit not marked done", visitErr.message);
  await logEvent(data.jobId, userId, "electrical_assessment_complete", `Electrical assessment complete – PIESA ${a.piesa_outcome} (${s.label})`, { scope: s.scope });
  // Decision 350: a PIESA done on the Mitti form files the official PIESA signed copy now (held with a reason, never
  // invented). Best-effort: the completion above stands either way.
  if (a.external_mitti_id) {
    try { await (await import("./official-piesa-issue.server")).issueOfficialPiesa(data.jobId, userId); } catch (e) { console.error("official PIESA not filed", (e as Error).message); }
  }
  let res: { advanced: boolean; scope: string };
  if (stage === "piesa_scheduled") {
    await transition(data.jobId, "piesa_complete", userId, `PIESA complete – ${a.piesa_outcome}${rectCount ? `, ${rectCount} electrical fixes item(s) listed` : a3Priced ? ", electrical fixes priced on the A3 form" : ", no electrical fixes required"}`, { piesa_outcome: a.piesa_outcome, rectification_items: rectCount ?? 0 });
    res = { advanced: true, scope: s.scope };
  } else res = await advanceSiteRequirements(data.jobId, userId);
  if (rectCount && !timesAlreadyGiven && data.rectWindows?.length) {
    // The same shared write as the decision-315 job-page card (rectification.server recordRectificationWindows).
    await (await import("./rectification.server")).recordRectificationWindows(data.jobId, userId, data.rectHours, data.rectWindows);
  }
  await autoAdvanceJob(data.jobId, userId, "assessment completed");
  // Decision 186: a pass with no fixes is electrical clearance — tell the installer once (nothing when not cleared).
  try { await (await import("./install-clearance.server")).notifyInstallerClearance(data.jobId); } catch (e) { console.error("install clearance notice failed", (e as Error).message); }
  return res;
}
