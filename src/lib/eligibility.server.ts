// Applies the deterministic Gate 1 auto-decision. Never overrides an admin decision.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { logEvent } from "./workflow.server";
import { evaluateGate1, type Gate1Decision } from "./eligibility.core";

export const AUTO_FAIL_HOLD_PREFIX = "Gate 1 auto-decision: does not appear eligible";

export async function autoDecideEligibility(jobId: string): Promise<Gate1Decision | null> {
  const { data: j } = await admin.from("jobs")
    .select("stage, eligibility_outcome, eligibility_decision_source, eligibility_decision_rules, life_support_status, properties(state, postcode, occupancy, is_residential, year_built, enrichment)")
    .eq("id", jobId).single();
  if (!j || !["new_enquiry", "eligibility_review"].includes(j.stage)) return null;
  if (j.eligibility_decision_source === "admin" || j.eligibility_decision_source === "system") return null; // admin decisions stand; system decides once
  const p = j.properties as { state: string | null; postcode: string | null; occupancy: string | null; is_residential: boolean | null; year_built: number | null; enrichment: Record<string, unknown> | null } | null;
  const e = (p?.enrichment ?? {}) as Record<string, unknown>;
  const { data: ws } = await admin.from("workflow_settings").select("min_building_age_years").limit(1).maybeSingle();
  const facts = {
    state: p?.state ?? null, postcode: p?.postcode ?? null, occupancy: p?.occupancy ?? null,
    isResidential: p?.is_residential ?? null, yearBuilt: p?.year_built ?? null, yearBuiltVerified: e["year_built_verified"] === true,
    minBuildingAgeYears: ws?.min_building_age_years ?? 2,
    lifeSupportStatus: j.life_support_status, previousCeilingUpgrade: typeof e["previous_ceiling_insulation_upgrade"] === "boolean" ? (e["previous_ceiling_insulation_upgrade"] as boolean) : null,
    flatRoofOrAccessConcern: e["flat_roof"] === true || e["access_concern"] === true,
    preliminaryOutcome: j.eligibility_decision_source === "preliminary" ? j.eligibility_outcome : null,
    currentYear: Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric" }).format(new Date())),
  };
  const d = evaluateGate1(facts);
  const audit = { rules_passed: d.passed, rules_failed: d.failed, needs_review: d.review, facts, sources: ["properties", "properties.enrichment", "jobs.life_support_status", "workflow_settings"], decided_at: new Date().toISOString() };
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
