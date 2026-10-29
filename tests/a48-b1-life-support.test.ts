// A48 batch 1 task 4 (Jo 29 Oct 2026): life support consent or a medical plan is needed BEFORE the safety check visit is
// booked (piesa_scheduled). Yes and Unknown both block; the owner's upload or the office record clears it; the
// electrician's own Yes on site marks the job (never cleared by a No). The REAL workflow.server stageEntryBlockers and
// job-records.server code runs against an in-memory database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { complianceRecordBlockers, lifeSupportNeedsPlan, lifeSupportPatchFromPiesa, type RecordKey } from "../src/lib/compliance-timeline.core";

const J = "00000000-0000-4000-8000-0000000000d1";
const MISSING = `Activity 48 record missing: Life support written consent / medical plan`;
const none = new Set<RecordKey>();
const plan = new Set<RecordKey>(["life_support_plan"]);

describe("pure rules", () => {
  test("yes and unknown need the plan; no and unanswered do not", () => {
    expect(lifeSupportNeedsPlan({ life_support: false, life_support_status: "yes" })).toBe(true);
    expect(lifeSupportNeedsPlan({ life_support: false, life_support_status: "unknown" })).toBe(true);
    expect(lifeSupportNeedsPlan({ life_support: true, life_support_status: null })).toBe(true);
    expect(lifeSupportNeedsPlan({ life_support: false, life_support_status: "no" })).toBe(false);
    expect(lifeSupportNeedsPlan({ life_support: false, life_support_status: null })).toBe(false);
  });
  test("the safety check visit is blocked until the plan exists; no life support is not blocked", () => {
    expect(complianceRecordBlockers("piesa_scheduled", none, { lifeSupport: true, ownerPaidIncGst: 0 })).toEqual([MISSING]);
    expect(complianceRecordBlockers("piesa_scheduled", plan, { lifeSupport: true, ownerPaidIncGst: 0 })).toEqual([]);
    expect(complianceRecordBlockers("piesa_scheduled", none, { lifeSupport: false, ownerPaidIncGst: 0 })).toEqual([]);
  });
  test("the retired stage no longer carries the rule; later stages still do", () => {
    expect(complianceRecordBlockers("assessment_booked", none, { lifeSupport: true, ownerPaidIncGst: 0 })).toEqual([]);
    for (const to of ["installation_booked", "evidence_outstanding"]) expect(complianceRecordBlockers(to, none, { lifeSupport: true, ownerPaidIncGst: 0 })).toContain(MISSING);
  });
  test("the electrician's answer: Yes marks the job, No and blank change nothing", () => {
    expect(lifeSupportPatchFromPiesa("Yes", { life_support: false, life_support_status: "no" })).toEqual({ life_support: true, life_support_status: "yes" });
    expect(lifeSupportPatchFromPiesa("Yes", { life_support: false, life_support_status: "unknown" })).toEqual({ life_support: true, life_support_status: "yes" });
    expect(lifeSupportPatchFromPiesa("Yes", { life_support: true, life_support_status: "yes" })).toBeNull();
    expect(lifeSupportPatchFromPiesa("No", { life_support: true, life_support_status: "yes" })).toBeNull();
    expect(lifeSupportPatchFromPiesa(undefined, { life_support: false, life_support_status: "no" })).toBeNull();
  });
});

const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: false, error: null }), storage: { from: () => ({ upload: async () => ({ error: { message: "no storage in test" } }) }) } } }));
const { stageEntryBlockers } = await import("../src/lib/workflow.server");
const { applyPiesaLifeSupport, recordComplianceRecord } = await import("../src/lib/job-records.server");

function seed(job: { life_support: boolean; life_support_status: string | null }) {
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    jobs: [{ id: J, job_number: "HV-0801", source: "website", stage: "piesa_and_install_window_pending", deleted_at: null, qa_archived_at: null, business_unit: "hivic", ...job }],
    job_compliance_records: [], owner_gate_signatures: [], invoices: [], workflow_events: [], job_assignments: [], assessments: [],
  });
}
const has = async (to: "piesa_scheduled" | "installation_booked") => (await stageEntryBlockers(J, to)).includes(MISSING);

describe("booking the safety check visit (piesa_scheduled) runs the life support blocker", () => {
  test("yes -> blocked; office record clears it", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    expect(await has("piesa_scheduled")).toBe(true);
    await recordComplianceRecord({ jobId: J, key: "life_support_plan", occurredAt: "2026-10-29", reference: null, notes: null, actorId: "00000000-0000-4000-8000-0000000000e1" });
    expect(await has("piesa_scheduled")).toBe(false);
  });
  test("yes -> the owner's upload (Gate C 'I have uploaded it') clears it", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    expect(await has("piesa_scheduled")).toBe(true);
    tables["owner_gate_signatures"]!.push({ job_id: J, doc_key: "life_support_plan", doc_version: "v1", signed_at: "2026-10-29T01:00:00Z" });
    expect(await has("piesa_scheduled")).toBe(false);
  });
  test("unknown (flag off) blocks like yes", async () => {
    seed({ life_support: false, life_support_status: "unknown" });
    expect(await has("piesa_scheduled")).toBe(true);
  });
  test("no -> not blocked", async () => {
    seed({ life_support: false, life_support_status: "no" });
    expect(await has("piesa_scheduled")).toBe(false);
  });
});

describe("the electrician's life support answer on site", () => {
  test("Yes on a 'no' job sets both fields, logs once, and the block applies before the install", async () => {
    seed({ life_support: false, life_support_status: "no" });
    expect(await has("installation_booked")).toBe(false);
    expect(await applyPiesaLifeSupport(J, null, "Yes")).toBe(true);
    expect(tables["jobs"]![0]).toMatchObject({ life_support: true, life_support_status: "yes" });
    expect(await has("installation_booked")).toBe(true);
    expect(await applyPiesaLifeSupport(J, null, "Yes")).toBe(false);
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "life_support_from_safety_check").length).toBe(1);
  });
  test("Yes on an 'unknown' job makes it yes", async () => {
    seed({ life_support: false, life_support_status: "unknown" });
    await applyPiesaLifeSupport(J, null, "Yes");
    expect(tables["jobs"]![0]).toMatchObject({ life_support: true, life_support_status: "yes" });
  });
  test("a PIESA No never clears an owner yes", async () => {
    seed({ life_support: true, life_support_status: "yes" });
    expect(await applyPiesaLifeSupport(J, null, "No")).toBe(false);
    expect(tables["jobs"]![0]).toMatchObject({ life_support: true, life_support_status: "yes" });
  });
  test("the Mitti sync calls it with the electrician's own answer", () => {
    expect(readFileSync("src/lib/mitti.server.ts", "utf8")).toContain('applyPiesaLifeSupport(jobId, actorId, shortAnswers["lifeSupportPresent"])');
  });
});
