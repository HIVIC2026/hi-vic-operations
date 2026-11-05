// Complete PIESA (the electrician's "Complete PIESA" on the job page): every completion check, then the PIESA record, the
// official PIESA signed copy (decision 350) and the guarded move to PIESA complete. Moved verbatim from the `completeAssessment`
// server function, which still checks the caller (admin or the job's electrician, allowed to record clearance) before calling
// this; the live full-journey runner (TEST jobs) completes the TEST electrician's PIESA through the same path.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent, stageEntryBlockers, transition, getStage } from "./workflow.server";
import { STAGE_LABEL } from "./workflow";
import { piesaDateBlockers } from "./piesa-date.core";
import { autoAdvanceJob } from "./autoadvance.server";
import { piesaCompletionKind } from "./repeat-piesa-form.core";
import { electricianBillsUpgrades } from "./upgrades-billing.core";
import { piesaRectificationDone } from "./piesa-evidence.core";

export type CompletePiesaInput = { jobId: string; rectHours?: number | undefined; rectWindows?: { date: string; slot: "8-10" | "10-12" | "12-14" | "14-16" }[] | undefined };

/** The caller must already be checked (admin, or the assigned electrician allowed to record clearance). J4 G1: on an
 *  in-house job the A3 sync completes the PIESA by itself (`piesa-auto-complete.server`), then the actor is the sync's
 *  (null on the tick) — the official copy's signer is always the job's electrician, never this actor. */
export async function completePiesaAssessment(data: CompletePiesaInput, userId: string | null) {
  const { data: a } = await admin.from("assessments").select("*").eq("job_id", data.jobId).maybeSingle();
  if (!a) throw new WorkflowError("Start the assessment first.");
  if (a.status === "complete") {
    // Batch 1 task 6: after a reopen the earlier check no longer counts; the new one is recorded as a reassessment.
    if (await (await import("./repeat-piesa.server")).currentPiesaSupersededByReopen(data.jobId)) throw new WorkflowError((await import("./repeat-piesa.core")).SUPERSEDED_USE_REASSESSMENT);
    // Fix 1: a same-day Part C record that failed after completion is written by pressing Complete PIESA again.
    if ((await retrySameDayPartC(data.jobId, userId)) === "recorded") return { advanced: true, scope: (await (await import("./requirements.server")).jobScope(data.jobId)).scope };
    throw new WorkflowError("Electrical assessment is already complete.");
  }
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
  // A48 batch 1: a Mitti PIESA whose answers break the official form's own rules cannot be completed.
  const rulesBlocker = await (await import("./piesa-rules-notice.server")).piesaRulesBlockerFor(data.jobId);
  if (rulesBlocker) throw new WorkflowError(rulesBlocker);
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
  // Part 3 Task 4b (Jo 4 Nov 2026): electricians quote, book and bill the electrical upgrades with the owner directly, so a
  // live A3 that says upgrades are needed completes with no portal items, no price and no fixes times. Items the A3 did list
  // stay listed (they are completed by the Part C record); unpriced "other" items no longer hold it.
  const short = a.external_mitti_id ? shortFrom("piesa", (a.mitti_raw_snapshot as { label: string; value: string | null }[] | null) ?? []) : null;
  const upgradesOnA3 = electricianBillsUpgrades() && liveA3 && !!short && /^yes\b/i.test(String(short["rectificationNeeded"] ?? "").trim());
  const { data: unpriced } = await admin.from("rectification_items").select("description").eq("job_id", data.jobId).eq("status", "required").eq("needs_office_pricing", true);
  if (unpriced?.length && !upgradesOnA3) throw new WorkflowError(`Home Insulation Victoria must price these items first: ${unpriced.map((u) => u.description).join(", ")}`);
  // Same-day rule: the PIESA submission must carry the rectification decision – priced items, or an explicit "none required".
  const { count: rectCount } = await admin.from("rectification_items").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).eq("status", "required");
  // A live A3 that says repair work is needed carries the electrician's own priced repair list (decisions 305/324):
  // that IS today's fixes quote (generated from the A3 after completion, decision 354), so no portal items are needed.
  const a3Priced = liveA3 && a.piesa_outcome === "fail" && (await import("./fixes-price.core")).fixesPriceSource(shortFrom("piesa", (a.mitti_raw_snapshot as { label: string; value: string | null }[] | null) ?? [])).path === "a4_price";
  // Mitti-only PIESA (C4, Jo 28 Oct 2026): the portal tick is gone. A live A3 whose answer is "No repair work needed" (a pass)
  // with no required fixes items IS "no electrical fixes required". Older / non-live forms still need the explicit tick.
  const a3NoFixes = liveA3 && a.piesa_outcome === "pass" && !rectCount;
  if (!rectCount && a.no_rectification_confirmed !== true && !a3Priced && !a3NoFixes && !upgradesOnA3) throw new WorkflowError("Add the electrical fixes items for today's quote, or tick \"No electrical fixes required\", before completing the PIESA.");
  if (rectCount && a.no_rectification_confirmed === true) throw new WorkflowError("You ticked \"No electrical fixes required\" but electrical fixes items are listed – untick it or remove the items.");

  // Rectification needed: the electrician also gives estimated hours + 3-5 windows (asked once, here) — unless they were
  // already given on the job page's "Fixes times" card (decision 315), which writes the same rows and event.
  // Part 3 Task 4b: not on an "upgrades needed" A3 — the electrician books the upgrades day with the owner (their link).
  const timesAlreadyGiven = rectCount && !upgradesOnA3 ? await (await import("./rectification.server")).rectificationWindowsExist(data.jobId) : false;
  if (rectCount && !timesAlreadyGiven && !upgradesOnA3) {
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
  // J4 G1: the automatic completion has no signed-in actor. The record's sign-off (`signed_off_by`, a profile — the clearance,
  // owner-declaration and installer-quote readers take a null here as "not signed yet") is the electrician's own login when
  // they have one, else the installer account running the job (the business that put its no-login Team electrician on the
  // job and booked the visit); the official PIESA copy is attributed to the electrician either way (issueOfficialPiesa).
  const signedOffBy = userId ?? await autoSignOffProfile(data.jobId);
  if (!signedOffBy) throw new WorkflowError("No account to record the PIESA sign-off against (no electrician login and no installer on the job).");
  // Jo 29 Oct 2026: a repeat PIESA (its own new Mitti form) is recorded as a reassessment; the first check stays on record.
  // Read BEFORE the assessment is marked complete, so an unreadable read leaves nothing half-written and it can be retried.
  const { count: prior, error: priorError } = await admin.from("piesa_records").select("id", { count: "exact", head: true }).eq("job_id", data.jobId).in("kind", ["initial", "reassessment"]);
  if (priorError) throw new WorkflowError("The earlier PIESA records could not be read, so the PIESA was not recorded. Please try again.");
  const now = new Date().toISOString();
  await admin.from("assessments").update({ status: "complete", completed_at: now, assessor_id: a.assessor_id ?? signedOffBy, mitti_sync_status: a.external_mitti_id ? "synced" : "not_synced" }).eq("id", a.id);
  await admin.from("piesa_records").update({ is_current: false }).eq("job_id", data.jobId).eq("is_current", true);
  await admin.from("piesa_records").insert({ job_id: data.jobId, assessment_id: a.id, kind: piesaCompletionKind(prior ?? 0), outcome: a.piesa_outcome, completed_date: a.assessed_on!, signed_off_by: signedOffBy, external_mitti_id: a.external_mitti_id });
  // The safety check visit is done: mark the confirmed assessment booking completed so the electrician's pay line shows in the
  // office Payouts (office-money lists it only for a completed assessment booking). Same as piesa-record.server does for fixes.
  const { error: visitErr } = await admin.from("bookings").update({ status: "completed" }).eq("job_id", data.jobId).eq("kind", "assessment").eq("status", "confirmed");
  if (visitErr) console.error("safety check visit not marked done", visitErr.message);
  await logEvent(data.jobId, userId, "electrical_assessment_complete", `Electrical assessment complete – PIESA ${a.piesa_outcome} (${s.label})`, { scope: s.scope, ...(userId ? {} : { completed_by: "synced A3 (in-house)", signed_off_by: signedOffBy }) });
  // Decision 350: a PIESA done on the Mitti form files the official PIESA signed copy now (held with a reason, never
  // invented). Best-effort: the completion above stands either way.
  if (a.external_mitti_id) {
    try { await (await import("./official-piesa-issue.server")).issueOfficialPiesa(data.jobId, userId); } catch (e) { console.error("official PIESA not filed", (e as Error).message); }
  }
  let res: { advanced: boolean; scope: string };
  if (stage === "piesa_scheduled") {
    await transition(data.jobId, "piesa_complete", userId, `PIESA complete – ${a.piesa_outcome}${upgradesOnA3 ? ", electrical upgrades needed (the electrician arranges them with the owner)" : rectCount ? `, ${rectCount} electrical fixes item(s) listed` : a3Priced ? ", electrical fixes priced on the A3 form" : ", no electrical fixes required"}`, { piesa_outcome: a.piesa_outcome, rectification_items: rectCount ?? 0 });
    res = { advanced: true, scope: s.scope };
    // Part 3 Task 4b: upgrades done on the same visit (q30 Yes + Part C on the A3) → the ONE post-rectification record path,
    // once per form: items completed, deposit requested, compliance checks passed, installation scheduling. The certificate
    // then reads "Waiting for certificate" / "certificate in" exactly as after the A4 form.
    if (upgradesOnA3 && short && piesaRectificationDone(short)) await recordSameDayPartC(data.jobId, userId ?? signedOffBy, a.external_mitti_id!, partCDate(short, a.assessed_on!));
  } else res = await advanceSiteRequirements(data.jobId, userId ?? signedOffBy);
  if (rectCount && !timesAlreadyGiven && !upgradesOnA3 && data.rectWindows?.length) {
    // The same shared write as the decision-315 job-page card (rectification.server recordRectificationWindows).
    await (await import("./rectification.server")).recordRectificationWindows(data.jobId, userId ?? signedOffBy, data.rectHours, data.rectWindows);
  }
  // Jo 2 Nov (answer 21) / Part 4 fix wave C1: the 50% deposit is requested on ANY recorded PIESA result — pass, or upgrades
  // still to come (eligibility gates on depositOpenAfterPiesa; non-in-house jobs come back 'not applicable').
  await (await import('./deposit-request.server')).requestInstallDeposit(data.jobId).catch(e=>console.error('Install deposit request held',e instanceof Error?e.message:'read failed'));
  await autoAdvanceJob(data.jobId, userId, "assessment completed");
  // J4 G1: a held "not completed by itself" office row (in-house jobs) is cleared by whichever path completed the PIESA.
  await (await import("./piesa-auto-complete.server")).clearPiesaAutoCompleteHold(data.jobId, userId).catch((e) => console.error("PIESA auto-complete hold not cleared", e instanceof Error ? e.message : String(e)));
  if (a.piesa_outcome === "pass" && !rectCount) {
    await (await import("./in-house-forms.server")).closeUnneededForms(data.jobId, "no_upgrades", userId).catch(e=>console.error("Unused in-house rectification closure failed", e instanceof Error ? e.message : "Form read failed"));
  }
  // Decision 186: a pass with no fixes is electrical clearance — tell the installer once (nothing when not cleared).
  // Part 4 Task 14: the decision 186 "cleared — offer 3 install days" installer notice is retired (the installer calls the owner to book).
  return res;
}

/** J4 G1: the profile the automatic (synced-A3) completion records the sign-off against — see completePiesaAssessment. */
async function autoSignOffProfile(jobId: string): Promise<string | null> {
  const { data: asg } = await admin.from("job_assignments").select("role, user_id").eq("job_id", jobId).eq("active", true).in("role", ["electrician", "installer"]);
  const rows = (asg ?? []) as { role: string; user_id: string | null }[];
  return rows.find((r) => r.role === "electrician" && r.user_id)?.user_id ?? rows.find((r) => r.role === "installer" && r.user_id)?.user_id ?? null;
}

/** Part 3 Task 4b: the Part C date on a same-day A3 — the certificate date when the answers give a valid one (not in the
 *  future, not before the safety check), else the safety check date. Melbourne calendar dates. */
export function partCDate(short: Record<string, unknown>, assessedOn: string): string {
  const checked = assessedOn.slice(0, 10);
  const d = String(short["certDate"] ?? "").trim().slice(0, 10);
  // Fix 1: Part C can't be signed before the safety check itself, so an earlier certificate date uses the check date.
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && piesaDateBlockers(d).length === 0 && d >= checked ? d : checked;
}

/** The same-day Part C record (once per A3 form; a repeat is a no-op in applyPiesaRecord). A standing stage guard on the move
 *  to installation scheduling keeps the job where it is with the reason as its next step — the PIESA completion stands.
 *  Fix 1: ANY other error never strands the job either: the reason goes in the next step and ONE internal office row
 *  (`same_day_part_c_failed`, one per form) is logged; the completion carries on, and the portal retries it each tick
 *  (sweepSameDayPartCRetries → retrySameDayPartC). Never throws. */
async function recordSameDayPartC(jobId: string, userId: string | null, auditId: string, date: string): Promise<"recorded" | "failed"> {
  try {
    const { applyPiesaRecord } = await import("./piesa-record.server");
    try {
      await applyPiesaRecord({ jobId, actorId: userId, kind: "post_rectification", outcome: "pass", completedDate: date, sectionCSignedDate: date, notes: `Electrical upgrades done on the safety check visit (Part C on the Mitti PIESA form ${auditId}).`, source: { kind: "mitti_a3_same_day", auditId } });
    } catch (e) {
      if (!(e instanceof WorkflowError)) throw e;
      await admin.from("jobs").update({ next_action: e.message.replace(/^Blocked:\s*/, "") }).eq("id", jobId);
    }
    return "recorded";
  } catch (e) {
    const reason = (e instanceof Error ? e.message : "").trim() || "unknown error";
    console.error("same-day Part C record failed", jobId, reason);
    try {
      const { SAME_DAY_PART_C_FAILED_EVENT, sameDayPartCFailedLine } = await import("./same-day-part-c.core");
      const line = sameDayPartCFailedLine(reason);
      const { error: naErr } = await admin.from("jobs").update({ next_action: line }).eq("id", jobId);
      if (naErr) console.error("same-day Part C next step not set", jobId, naErr.message);
      const { stableUuid, isUniqueViolation } = await import("./mitti-create-claim.core");
      const { error: evErr } = await admin.from("workflow_events").insert({
        id: await stableUuid(`same-day-part-c-failed:${jobId}:${auditId}`), job_id: jobId, actor_id: userId, event_type: SAME_DAY_PART_C_FAILED_EVENT,
        summary: line, details: { audit_id: auditId, reason, needs_office: true }, internal: true,
      });
      if (evErr && !isUniqueViolation(evErr)) console.error("same-day Part C office row not recorded", jobId, evErr.message);
    } catch (e2) { console.error("same-day Part C failure not recorded", jobId, e2 instanceof Error ? e2.message : "error"); }
    return "failed";
  }
}

/** Fix 1/2: write a same-day Part C record whose write failed. The portal retries it each tick (sweepSameDayPartCRetries);
 *  the sync of a completed A3 and a repeat Complete PIESA press also call it (harmless, not relied on). Runs ONLY while a
 *  `same_day_part_c_failed` row is open for this job (fix 2: no backfill — older same-day A3s are left alone) and the job is
 *  past PIESA complete but before installation scheduling. Fix 3: a retry that can never succeed closes the row (an
 *  internal `same_day_part_c_recovered` event with the reason) so the tick stops picking it — Part C already recorded
 *  another way ("Part C recorded another way"), or the stored A3 is no longer the failed form or no longer a same-day form
 *  ("form superseded"). A safety check superseded by a reopen closes the row with that reason too. Nothing is written in
 *  those cases. Signed off by whoever signed the PIESA. Fail-closed (an unreadable read does nothing and closes nothing)
 *  and never throws. */
export async function retrySameDayPartC(jobId: string, actorId: string | null): Promise<"recorded" | "failed" | "superseded" | "closed" | "none"> {
  try {
    const { data: a, error } = await admin.from("assessments").select("status, external_mitti_id, mitti_raw_snapshot, assessed_on").eq("job_id", jobId).maybeSingle();
    if (error || !a || a.status !== "complete" || !a.external_mitti_id || !a.assessed_on) return "none";
    if (!electricianBillsUpgrades()) return "none";
    const core = await import("./same-day-part-c.core");
    const stage = await getStage(jobId);
    if (!(core.SAME_DAY_PART_C_RETRY_STAGES as readonly string[]).includes(stage)) return "none";
    const [{ data: post, error: postErr }, { data: evs, error: evErr }, { data: signer, error: sErr }] = await Promise.all([
      admin.from("piesa_records").select("id").eq("job_id", jobId).eq("kind", "post_rectification").eq("outcome", "pass").eq("is_current", true).limit(1),
      admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [core.SAME_DAY_PART_C_FAILED_EVENT, core.SAME_DAY_PART_C_RECOVERED_EVENT]),
      admin.from("piesa_records").select("signed_off_by").eq("job_id", jobId).in("kind", ["initial", "reassessment"]).order("created_at", { ascending: false }).limit(1),
    ]);
    if (postErr || evErr || sErr) return "none";
    // The job's open failure row, whichever form it was for (the office row and the tick are per job too).
    const evList = (evs ?? []) as { event_type: string; created_at: string; details: Record<string, unknown> | null }[];
    if (!core.sameDayPartCFailedOpen(evList, { stage, postRecord: false })) return "none";
    const failedAudit = String(evList.filter((e) => e.event_type === core.SAME_DAY_PART_C_FAILED_EVENT).sort((x, y) => y.created_at.localeCompare(x.created_at))[0]?.details?.["audit_id"] ?? "");
    const close = async (reason: string, summary: string) => {
      await logEvent(jobId, actorId, core.SAME_DAY_PART_C_RECOVERED_EVENT, summary, { audit_id: failedAudit || null, reason }, { internal: true });
    };
    // Fix 3: Part C is already recorded (by hand on the portal or an A4) — nothing left to write.
    if ((post ?? []).length > 0) { await close("Part C recorded another way", "Same-day Part C record not needed — Part C recorded another way"); return "closed"; }
    // Fix 3: the stored A3 is no longer the form that failed, or no longer says the upgrades were done that day with Part C.
    const auditId = a.external_mitti_id;
    const { isLiveA3Snapshot, shortAnswersFromEntries } = await import("./official-short.core");
    const short = shortAnswersFromEntries("piesa", (a.mitti_raw_snapshot as { label: string; value: string | null }[] | null) ?? []);
    const sameDayForm = isLiveA3Snapshot(a.mitti_raw_snapshot) && /^yes\b/i.test(String(short["rectificationNeeded"] ?? "").trim()) && piesaRectificationDone(short);
    if (failedAudit !== auditId || !sameDayForm) { await close("form superseded", "Same-day Part C record not written — form superseded"); return "closed"; }
    // Fix 2: like the Complete PIESA press, a safety check a reopen superseded no longer counts — close the row, write nothing.
    if (await (await import("./repeat-piesa.server")).currentPiesaSupersededByReopen(jobId)) {
      await logEvent(jobId, actorId, core.SAME_DAY_PART_C_RECOVERED_EVENT, "Same-day Part C record not written — safety check superseded by a reopen", { audit_id: auditId, reason: "safety check superseded by a reopen" }, { internal: true });
      return "superseded";
    }
    const userId = ((signer ?? []) as { signed_off_by: string | null }[])[0]?.signed_off_by ?? actorId;
    const r = await recordSameDayPartC(jobId, userId, auditId, partCDate(short, a.assessed_on));
    if (r === "recorded") {
      await logEvent(jobId, actorId, core.SAME_DAY_PART_C_RECOVERED_EVENT, "Same-day Part C record written", { audit_id: auditId }, { internal: true });
      // Clear our own next step only (a stage guard's reason, set just now, stays).
      const { data: j } = await admin.from("jobs").select("next_action").eq("id", jobId).maybeSingle();
      if (String(j?.next_action ?? "").startsWith(core.SAME_DAY_PART_C_FAILED_PREFIX)) await admin.from("jobs").update({ next_action: null }).eq("id", jobId);
    }
    return r;
  } catch (e) {
    console.error("same-day Part C retry skipped", jobId, e instanceof Error ? e.message : "error");
    return "none";
  }
}

/** Fix 2 (tick): the same-day Part C record is retried here — completed A3s are never synced again and the office buttons
 *  are hidden once complete, so this is the path that writes it. Reads the open `same_day_part_c_failed` rows only (newest
 *  failed / recovered per job, a tie goes to the failure), skips jobs outside the retry stages in one read, and retries at
 *  most SAME_DAY_PART_C_RETRY_MAX_PER_TICK jobs, oldest failure first. Never throws: a read error returns zero counts, and
 *  one job's error is logged and the loop carries on. Counts only. */
export const SAME_DAY_PART_C_RETRY_MAX_PER_TICK = 20;
export async function sweepSameDayPartCRetries(_now: Date = new Date()): Promise<{ open: number; tried: number; recorded: number; failed: number; superseded: number; closed: number; none: number }> {
  const out = { open: 0, tried: 0, recorded: 0, failed: 0, superseded: 0, closed: 0, none: 0 };
  try {
    const core = await import("./same-day-part-c.core");
    const { data: evs, error } = await admin.from("workflow_events").select("job_id, event_type, created_at, details").in("event_type", [core.SAME_DAY_PART_C_FAILED_EVENT, core.SAME_DAY_PART_C_RECOVERED_EVENT]).order("created_at", { ascending: false }).limit(1000);
    if (error) { console.error("same-day Part C retry sweep: events unreadable", error.message); return out; }
    const byJob = new Map<string, { event_type: string; created_at: string; details: Record<string, unknown> | null }[]>();
    for (const e of (evs ?? []) as { job_id: string; event_type: string; created_at: string; details: Record<string, unknown> | null }[]) byJob.set(e.job_id, [...(byJob.get(e.job_id) ?? []), e]);
    // Stage and Part C record are checked per job by the retry; here only the events decide (stage unknown keeps it open).
    const open = [...byJob].map(([jobId, list]) => ({ jobId, at: core.sameDayPartCFailedOpen(list, { stage: null, postRecord: false })?.at ?? null })).filter((x): x is { jobId: string; at: string } => !!x.at);
    out.open = open.length;
    if (!open.length) return out;
    const { data: jobs, error: jErr } = await admin.from("jobs").select("id, stage").in("id", open.map((x) => x.jobId)).is("deleted_at", null);
    if (jErr) { console.error("same-day Part C retry sweep: jobs unreadable", jErr.message); return out; }
    const due = new Set(((jobs ?? []) as { id: string; stage: string }[]).filter((j) => (core.SAME_DAY_PART_C_RETRY_STAGES as readonly string[]).includes(j.stage)).map((j) => j.id));
    const todo = open.filter((x) => due.has(x.jobId)).sort((a, b) => a.at.localeCompare(b.at)).slice(0, SAME_DAY_PART_C_RETRY_MAX_PER_TICK);
    for (const x of todo) {
      out.tried++;
      try { out[await retrySameDayPartC(x.jobId, null)]++; } catch (e) { out.failed++; console.error("same-day Part C retry failed", x.jobId, e instanceof Error ? e.message : "error"); }
    }
  } catch (e) { console.error("same-day Part C retry sweep skipped", e instanceof Error ? e.message : "error"); }
  return out;
}
