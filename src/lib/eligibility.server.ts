// Applies the ONE deterministic Gate 1 categoriser (eligibility.core). Never overrides an admin decision.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent } from "./workflow.server";
import { evaluateGate1, gate1Audit, gate1Signature, resolveGate1Facts, type Gate1Decision, type StoredProperty, type IntelFact } from "./eligibility.core";

export const AUTO_FAIL_HOLD_PREFIX = "Gate 1 auto-decision: does not appear eligible";

const melbDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(d);
export const todayMelbourne = () => melbDate(new Date());

/** Activity reference date: confirmed installation start, else today (Melbourne). */
export async function referenceDate(jobId: string): Promise<{ date: string; basis: string }> {
  const { data } = await admin.from("bookings").select("scheduled_start").eq("job_id", jobId).eq("kind", "installation").eq("status", "confirmed").order("scheduled_start", { ascending: false }).limit(1).maybeSingle();
  if (data?.scheduled_start) return { date: melbDate(new Date(data.scheduled_start)), basis: "installation_booking" };
  return { date: todayMelbourne(), basis: "today" };
}

const JOB_COLS = "stage, eligibility_outcome, eligibility_reason, eligibility_decision_source, eligibility_decision_rules, eligibility_review_required, eligibility_flags, life_support_status, estimated_area_unknown, estimated_area_m2, properties(state, postcode, occupancy, is_residential, year_built, enrichment)";
type StoredJob = { eligibility_outcome: string | null; eligibility_decision_source: string | null; life_support_status: string | null; estimated_area_unknown: boolean | null; estimated_area_m2: number | null; properties: unknown };

async function evaluateStored(j: StoredJob, jobId: string, refDate?: string) {
  const { data: intel } = await admin.from("property_facts").select("fact_key, value, evidence_kind, confidence, source_type, source_name, source_url, is_current, is_stale").eq("job_id", jobId).eq("is_current", true);
  const { data: ws } = await admin.from("workflow_settings").select("min_building_age_years").limit(1).maybeSingle();
  const ref = refDate ?? (await referenceDate(jobId)).date;
  const prelim = j.eligibility_decision_source !== "admin" && j.eligibility_decision_source !== "system" ? j.eligibility_outcome : null;
  const facts = resolveGate1Facts(j.properties as StoredProperty | null, {
    lifeSupportStatus: j.life_support_status, preliminaryOutcome: prelim, referenceDate: ref,
    areaUnknown: j.estimated_area_unknown || j.estimated_area_m2 == null,
  }, ws?.min_building_age_years ?? 5, Number(ref.slice(0, 4)), (intel ?? []) as IntelFact[]);
  return { facts, d: evaluateGate1(facts) };
}

/** Authoritative evaluation for a job (read-only). Property Intelligence stores this as its diagnostic result. */
export async function evaluateJobGate1(jobId: string, refDate?: string): Promise<Gate1Decision | null> {
  const { data: j } = await admin.from("jobs").select(JOB_COLS).eq("id", jobId).single();
  if (!j) return null;
  return (await evaluateStored(j as StoredJob, jobId, refDate)).d;
}

export async function autoDecideEligibility(jobId: string, opts: { initialProcessor?: boolean } = {}): Promise<Gate1Decision | null> {
  const { data: j } = await admin.from("jobs").select(JOB_COLS).eq("id", jobId).single();
  if (!j) return null;
  if (j.eligibility_decision_source === "admin") { await refreshGate1Flags(jobId); return null; } // admin decisions stand
  // Initial checks still queued/processing: only the post-intake processor may record the first official decision.
  if (!opts.initialProcessor) {
    const { data: pending } = await admin.from("post_intake_work").select("id").eq("job_id", jobId).in("status", ["queued", "processing", "retry"]).limit(1);
    if ((pending ?? []).length) return null;
  }
  if (!["new_enquiry", "eligibility_review"].includes(j.stage)) return null;
  const { facts, d } = await evaluateStored(j as StoredJob, jobId);
  const prev = j.eligibility_decision_rules as { ruleset_version?: string; signature?: string } | null;
  const sig = gate1Signature(d);
  // Idempotent: unchanged system categorisation -> no write, no event.
  if (j.eligibility_decision_source === "system" && prev?.signature === sig && prev.ruleset_version === d.ruleset_version && (j.eligibility_outcome ?? null) === d.outcome) return d;
  const now = new Date().toISOString();
  const audit = { ...gate1Audit(d, facts, now), signature: sig, sources: ["properties", "properties.enrichment (incl. base44 declared/research/raw answers)", "jobs.life_support_status", "workflow_settings", "property_facts (trusted direct high-confidence only)"] };
  const reason = d.failed.length ? `Auto-fail: ${d.failed.join("; ")}` : d.review.length ? `Review required: ${d.review.join("; ")}` : d.onsite.length ? `Needs onsite confirmation: ${d.onsite.join("; ")}` : `Auto-pass: ${d.passed.join("; ")}`;
  await admin.from("jobs").update({
    eligibility_outcome: d.outcome, eligibility_reason: reason.slice(0, 2000), eligibility_set_by: null, eligibility_set_at: now,
    eligibility_decision_source: "system", eligibility_decision_rules: audit as unknown as Json,
    eligibility_review_required: d.reviewRequired, eligibility_flags: d.flags as unknown as Json, next_action: d.nextAction,
  }).eq("id", jobId);
  await logEvent(jobId, null, d.reviewRequired ? "eligibility_auto_review" : "eligibility_auto_decided",
    d.reviewRequired ? `Gate 1 REVIEW REQUIRED: ${d.review.join("; ")}` : `Gate 1 auto-categorised (system): ${d.outcome!.replace(/_/g, " ")}${d.rolloutHold ? " – rollout hold until 1 Oct 2026" : ""}`,
    audit, { internal: true });
  await admin.from("compliance_checks").update({ status: d.outcome === "likely_eligible" ? "pass" : d.outcome === "does_not_appear_eligible" ? "fail" : "pending", checked_by: null, checked_at: now, notes: `System: ${reason}`.slice(0, 2000) }).eq("job_id", jobId).eq("check_key", "eligibility");
  if (d.outcome === "does_not_appear_eligible") {
    const hold = `${AUTO_FAIL_HOLD_PREFIX} – ${d.failed.join("; ")}`;
    await admin.from("jobs").update({ stage: "on_hold", prior_stage: j.stage, hold_reason: hold.slice(0, 1000) }).eq("id", jobId);
    await logEvent(jobId, null, "stage_changed", `Held out of workflow (reversible by admin): ${hold}`, audit, { from: j.stage, to: "on_hold" });
  }
  return d;
}

/** Admin-decided jobs keep their outcome; only safety/operational flags (incl. rollout hold) are refreshed. */
export async function refreshGate1Flags(jobId: string): Promise<Gate1Decision | null> {
  const { data: j } = await admin.from("jobs").select(JOB_COLS).eq("id", jobId).single();
  if (!j) return null;
  const { d } = await evaluateStored(j as StoredJob, jobId);
  if (JSON.stringify(j.eligibility_flags ?? []) !== JSON.stringify(d.flags) || j.eligibility_review_required)
    await admin.from("jobs").update({ eligibility_flags: d.flags as unknown as Json, eligibility_review_required: false }).eq("id", jobId);
  return d;
}

/** Read-only: what the Gate 1 rules say right now, plus the recorded decision. */
export async function previewGate1(jobId: string) {
  const { data: j } = await admin.from("jobs").select(JOB_COLS).eq("id", jobId).single();
  if (!j) return null;
  const { d } = await evaluateStored(j as StoredJob, jobId);
  const rec = (j.eligibility_decision_rules ?? null) as Json;
  return {
    live: d,
    recorded: {
      outcome: j.eligibility_outcome, source: j.eligibility_decision_source, reason: j.eligibility_reason,
      reviewRequired: !!j.eligibility_review_required, flags: (j.eligibility_flags ?? []) as unknown as Gate1Decision["flags"],
      audit: rec,
    },
  };
}
