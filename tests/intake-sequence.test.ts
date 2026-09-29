// Fresh Base44 intake order: Step 1 → initial Property Intelligence → ONE official Gate 1 decision. Run: bun test ./tests/
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, any>;
const JOB = "job-1";
const db: Record<string, Row[]> = {};
const reset = (job: Partial<Row> = {}, facts: Row[] = []) => {
  db["jobs"] = [{ id: JOB, stage: "new_enquiry", eligibility_outcome: null, eligibility_reason: null, eligibility_decision_source: null, eligibility_decision_rules: null,
    eligibility_review_required: false, eligibility_flags: [], life_support_status: "no", estimated_area_unknown: false, estimated_area_m2: 120,
    properties: { state: "VIC", postcode: "3058", occupancy: "owner_occupied", is_residential: null, year_built: null,
      enrichment: { base44: { declared: { property_type: "house", over_five_years: "yes", previous_upgrade: "no" }, raw: { answers: { insulation: "none" } } } } }, ...job }];
  db["property_facts"] = facts; db["workflow_settings"] = [{ min_building_age_years: 5 }]; db["bookings"] = []; db["compliance_checks"] = [];
  db["workflow_events"] = []; db["owner_contact_consents"] = []; db["documents"] = [];
};
function q(table: string) {
  const filters: [string, unknown][] = [];
  const rows = () => (db[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
  let patch: Row | null = null;
  const api: any = {
    select: () => api, order: () => api, limit: () => api, neq: () => api,
    eq: (k: string, v: unknown) => { filters.push([k, v]); if (patch) { rows().forEach((r) => Object.assign(r, patch)); } return api; },
    single: async () => ({ data: rows()[0] ?? null }), maybeSingle: async () => ({ data: rows()[0] ?? null }),
    update: (p: Row) => { patch = p; return api; },
    then: (res: any) => res({ data: rows(), error: null }),
  };
  return api;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {}, logEvent: async (job_id: string, _a: unknown, event_type: string) => { db["workflow_events"]!.push({ job_id, event_type }); } }));
const { autoDecideEligibility } = await import("../src/lib/eligibility.server");
const { runPostIntakeSequence } = await import("../src/lib/enquiry.server");

const gate1Events = () => db["workflow_events"]!.filter((e) => e["event_type"] === "eligibility_auto_review" || e["event_type"] === "eligibility_auto_decided");
const trusted = (fact_key: string, value: unknown) => ({ job_id: JOB, is_current: true, is_stale: false, fact_key, value, evidence_kind: "direct", confidence: "high", source_type: "public_gis", source_name: "Vicmap" });

/** Simulates runPropertyIntelligence: records the run, stores facts, then (success path only) feeds Gate 1. */
const fakeIntel = (ok: boolean, log: string[]) => async () => {
  log.push("intel_start");
  expect(gate1Events()).toHaveLength(0); // A: nothing official persisted before the run completes
  expect(db["jobs"]![0]!["eligibility_decision_source"]).toBeNull();
  if (!ok) { db["workflow_events"]!.push({ event_type: "property_intelligence_error" }); log.push("intel_error"); throw new Error("provider down"); }
  db["property_facts"]!.push(trusted("address_verified", true), trusted("in_victoria", true));
  db["workflow_events"]!.push({ event_type: "property_intelligence_run" }); log.push("intel_done");
  await autoDecideEligibility(JOB);
};
const gate1 = (log: string[]) => async () => { log.push("gate1"); await autoDecideEligibility(JOB); };

describe("fresh Base44 intake sequencing", () => {
  test("A+B: successful intelligence → exactly one official decision, recorded after the run", async () => {
    reset(); const log: string[] = [];
    await runPostIntakeSequence({ completeIntake: async () => { log.push("intake"); }, intelligence: fakeIntel(true, log), gate1: gate1(log) });
    expect(log).toEqual(["intake", "intel_start", "intel_done", "gate1"]);
    const types = db["workflow_events"]!.map((e) => e["event_type"]);
    expect(gate1Events()).toHaveLength(1);
    expect(types.indexOf("eligibility_auto_decided")).toBeGreaterThan(types.indexOf("property_intelligence_run"));
    expect(types).not.toContain("eligibility_auto_review"); // no premature REVIEW REQUIRED
    expect(db["jobs"]![0]!["eligibility_outcome"]).toBe("likely_eligible");
  });
  test("C: intelligence error → Gate 1 still runs once afterwards (may be REVIEW REQUIRED)", async () => {
    reset(); const log: string[] = [];
    await runPostIntakeSequence({ completeIntake: null, intelligence: fakeIntel(false, log), gate1: gate1(log) });
    expect(log).toEqual(["intel_start", "intel_error", "gate1"]);
    expect(gate1Events()).toHaveLength(1);
    expect(gate1Events()[0]!["event_type"]).toBe("eligibility_auto_review"); // no trusted address evidence
    expect(db["jobs"]![0]!["eligibility_review_required"]).toBe(true);
  });
  test("D: repeat idempotent sync with unchanged facts adds no Gate 1 event", async () => {
    reset(); const log: string[] = [];
    await runPostIntakeSequence({ completeIntake: null, intelligence: fakeIntel(true, log), gate1: gate1(log) });
    await runPostIntakeSequence({ completeIntake: null, intelligence: async () => {}, gate1: gate1(log) }); // repeat: no rerun needed
    expect(gate1Events()).toHaveLength(1);
  });
  test("E: admin decision is never overwritten", async () => {
    reset({ eligibility_decision_source: "admin", eligibility_outcome: "does_not_appear_eligible" }); const log: string[] = [];
    await runPostIntakeSequence({ completeIntake: null, intelligence: async () => { db["property_facts"]!.push(trusted("address_verified", true), trusted("in_victoria", true)); await autoDecideEligibility(JOB); }, gate1: gate1(log) });
    expect(db["jobs"]![0]!["eligibility_outcome"]).toBe("does_not_appear_eligible");
    expect(db["jobs"]![0]!["eligibility_decision_source"]).toBe("admin");
    expect(gate1Events()).toHaveLength(0);
  });
  test("F: Step 1 intake (consent/media) still runs first and unchanged", () => {
    const src = readFileSync("src/lib/enquiry.server.ts", "utf8");
    expect(src).toMatch(/async function completeIntake[\s\S]*recordContactConsent\(jobId, ownerId, input\);[\s\S]*importBase44Media\(jobId, input\.media \?\? \[\]\)/);
    // Both new and repeat syncs go through the ordered sequence; no bare Gate 1 call before intelligence.
    expect(src.match(/runPostIntakeSequence\(\{/g)).toHaveLength(2);
    expect(src).not.toMatch(/await runGate1\([^)]*\);\s*await afterEnquiry/);
  });
});
