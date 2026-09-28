// Applies the deterministic Gate 1 auto-decision. Never overrides an admin decision.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent } from "./workflow.server";
import { evaluateGate1, resolveGate1Facts, type Gate1Decision, type StoredProperty, type IntelFact } from "./eligibility.core";

export const AUTO_FAIL_HOLD_PREFIX = "Gate 1 auto-decision: does not appear eligible";

export async function autoDecideEligibility(jobId: string): Promise<Gate1Decision | null> {
  const { data: j } = await admin.from("jobs")
    .select("stage, eligibility_outcome, eligibility_decision_source, eligibility_decision_rules, life_support_status, properties(state, postcode, occupancy, is_residential, year_built, enrichment)")
    .eq("id", jobId).single();
  if (!j || !["new_enquiry", "eligibility_review"].includes(j.stage)) return null;
  if (j.eligibility_decision_source === "admin" || j.eligibility_decision_source === "system") return null; // admin decisions stand; system decides once
  const { facts, d } = await evaluateStored(j);
  const audit = { rules_passed: d.passed, rules_failed: d.failed, needs_review: d.review, rules: d.rules, facts, sources: ["properties", "properties.enrichment (incl. base44 declared/research)", "jobs.life_support_status", "workflow_settings"], decided_at: new Date().toISOString() };
  if (!d.outcome) {
    // Unchanged review list -> no new event (idempotent sweeps).
    const prev = (j.eligibility_decision_rules as { needs_review?: string[] } | null)?.needs_review ?? [];
    if (JSON.stringify(prev) !== JSON.stringify(d.review)) {
      await admin.from("jobs").update({ eligibility_decision_rules: audit as Json }).eq("id", jobId);
      await logEvent(jobId, null, "eligibility_auto_review", `Gate 1 needs human review: ${d.review.join("; ")}`, audit, { internal: true });
    }
    return d;
  }
  const reason = d.outcome === "likely_eligible" ? `Auto-pass: ${d.passed.join("; ")}` : `Auto-fail: ${d.failed.join("; ")}`;
  await admin.from("jobs").update({
    eligibility_outcome: d.outcome, eligibility_reason: reason, eligibility_set_by: null, eligibility_set_at: audit.decided_at,
    eligibility_decision_source: "system", eligibility_decision_rules: audit as Json,
    next_action: d.outcome === "likely_eligible" ? "Assign electrician" : "Review auto-fail – admin may override with reason",
  }).eq("id", jobId);
  await logEvent(jobId, null, "eligibility_auto_decided", `Gate 1 auto-decision (system): ${d.outcome.replace(/_/g, " ")}`, audit);
  await admin.from("compliance_checks").update({ status: d.outcome === "likely_eligible" ? "pass" : "fail", checked_by: null, checked_at: audit.decided_at, notes: `System: ${reason}` }).eq("job_id", jobId).eq("check_key", "eligibility");
  if (d.outcome === "does_not_appear_eligible") {
    const hold = `${AUTO_FAIL_HOLD_PREFIX} – ${d.failed.join("; ")}`;
    await admin.from("jobs").update({ stage: "on_hold", prior_stage: j.stage, hold_reason: hold }).eq("id", jobId);
    await logEvent(jobId, null, "stage_changed", `Held out of workflow: ${hold}`, audit, { from: j.stage, to: "on_hold" });
  }
  return d;
}

type StoredJob = { eligibility_outcome: string | null; eligibility_decision_source: string | null; life_support_status: string | null; properties: unknown };
async function evaluateStored(j: StoredJob, jobId: string) {
  const { data: intel } = await admin.from("property_facts").select("fact_key, value, evidence_kind, confidence, source_type, source_name, source_url, is_current, is_stale").eq("job_id", jobId).eq("is_current", true);
  const { data: ws } = await admin.from("workflow_settings").select("min_building_age_years").limit(1).maybeSingle();
  const year = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric" }).format(new Date()));
  const facts = resolveGate1Facts(j.properties as StoredProperty | null, {
    lifeSupportStatus: j.life_support_status,
    preliminaryOutcome: j.eligibility_decision_source === "preliminary" ? j.eligibility_outcome : null,
  }, ws?.min_building_age_years ?? 2, year, (intel ?? []) as IntelFact[]);
  return { facts, d: evaluateGate1(facts) };
}

/** Read-only: what the Gate 1 rules say right now, per rule, with source and declared/verified basis. */
export async function previewGate1(jobId: string) {
  const { data: j } = await admin.from("jobs")
    .select("stage, eligibility_outcome, eligibility_decision_source, eligibility_decision_rules, eligibility_reason, life_support_status, properties(state, postcode, occupancy, is_residential, year_built, enrichment)")
    .eq("id", jobId).single();
  if (!j) return null;
  const { d } = await evaluateStored(j);
  return {
    live: { outcome: d.outcome, rules: d.rules },
    recorded: { outcome: j.eligibility_outcome, source: j.eligibility_decision_source, reason: j.eligibility_reason, rules: (j.eligibility_decision_rules as { rules?: unknown } | null)?.rules ?? null },
  };
}
