// Task 9 fix round 1 (IMPORTANT 1): the PIESA completion gate for a live A3 that ticks repair work. The repair list must
// read in full (downlight count, RCD count, "Other" description) — a price is NOT needed (the owner prices it later).
// Real completePiesaAssessment over an in-memory PostgREST.
// Run on its own (bun shares mock.module across files in one process): bun test tests/piesa-complete-repair-gate.test.ts
import { describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { A3_REPAIR_NEEDED_LABEL, FIXES_DOWNLIGHT_COUNT_LABEL, FIXES_OTHER_LABEL, FIXES_RCD_COUNT_LABEL, FIXES_WORK_LABEL, FIXES_WORK_OPTIONS } from "../src/lib/official-short.core";

const JOB = "00000000-0000-4000-8000-000000000a01";
const ASSESS = "00000000-0000-4000-8000-000000000a02";
const STAFF = "00000000-0000-4000-8000-000000000ac1";
const [DL, RCD] = FIXES_WORK_OPTIONS;
const OTHER = "Other";
const BLOCKED = "Add the electrical fixes items for today's quote, or tick \"No electrical fixes required\", before completing the PIESA.";

type Entry = { label: string; value: string | null };
function tables(snapshot: Entry[]): Tables {
  return {
    jobs: [{ id: JOB, job_number: "HV-9A01", stage: "piesa_scheduled", channel: "hivic_sourced", source: "qa_test", deleted_at: null, originating_installer_business_id: null, next_action: null, hold_reason: null, owner_id: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" }],
    assessments: [{ id: ASSESS, job_id: JOB, status: "in_progress", external_mitti_id: "audit-a3-1", mitti_raw_snapshot: snapshot, mitti_completed: true, switchboard_condition: null, rcds_present: null, life_support_confirmed: false, piesa_outcome: "fail", assessed_on: "2026-10-27", no_rectification_confirmed: false, assessor_id: STAFF }],
    rectification_items: [], evidence_requirements: [], piesa_records: [], quotes: [], quote_items: [], rectification_windows: [], workflow_events: [],
  };
}
let T = tables([]);
const moves: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(T).from(t), rpc: async () => ({ data: null, error: null }) } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  stageEntryBlockers: async () => [],
  transition: async (jobId: string, to: string) => { moves.push(to); const j = T["jobs"]!.find((r) => r["id"] === jobId); if (j) j["stage"] = to; },
}));
const realAuto = await import("../src/lib/autoadvance.server");
mock.module("../src/lib/autoadvance.server", () => ({ ...realAuto, autoAdvanceJob: async () => undefined }));
const realClear = await import("../src/lib/install-clearance.server");
mock.module("../src/lib/install-clearance.server", () => ({ ...realClear, notifyInstallerClearance: async () => undefined }));
const realReq = await import("../src/lib/requirements.server");
mock.module("../src/lib/requirements.server", () => ({ ...realReq, jobScope: async () => ({ scope: "COMPLETE", label: "complete" }), advanceSiteRequirements: async () => ({ advanced: false, scope: "COMPLETE" }) }));
const realRect = await import("../src/lib/rectification.server");
mock.module("../src/lib/rectification.server", () => ({ ...realRect, rectificationWindowsExist: async () => true, fixesTimesHoldFor: async () => null, recordRectificationWindows: async () => undefined }));
// The photo / geotag evidence rule is another module's job; this file is about the repair list.
const realEvidence = await import("../src/lib/piesa-evidence.core");
mock.module("../src/lib/piesa-evidence.core", () => ({ ...realEvidence, piesaEvidenceBlockersFromSnapshot: () => [] }));

const yes: Entry = { label: A3_REPAIR_NEEDED_LABEL, value: "Yes" };
const work = (...ticks: string[]): Entry => ({ label: FIXES_WORK_LABEL, value: ticks.join(", ") });
const complete = async () => (await import("../src/lib/piesa-complete.server")).completePiesaAssessment({ jobId: JOB }, STAFF);
const run = (snapshot: Entry[]) => { T = tables(snapshot); moves.length = 0; };

describe("the PIESA completion gate for the electrician's repair list", () => {
  test("ticks read in full and no price: completes (the owner prices it later)", async () => {
    run([yes, work(DL, RCD), { label: FIXES_DOWNLIGHT_COUNT_LABEL, value: "6" }, { label: FIXES_RCD_COUNT_LABEL, value: "1" }]);
    await complete();
    expect(T["assessments"]![0]!["status"]).toBe("complete");
    expect(moves).toEqual(["piesa_complete"]);
  });

  test("\"Yes\" and nothing ticked: blocked", async () => {
    run([yes]);
    await expect(complete()).rejects.toThrow(BLOCKED);
    expect(T["assessments"]![0]!["status"]).toBe("in_progress");
    expect(moves).toEqual([]);
  });

  test("downlights ticked with no count: blocked", async () => {
    run([yes, work(DL)]);
    await expect(complete()).rejects.toThrow(BLOCKED);
    expect(T["assessments"]![0]!["status"]).toBe("in_progress");
  });

  test("RCDs ticked with no count: blocked", async () => {
    run([yes, work(RCD)]);
    await expect(complete()).rejects.toThrow(BLOCKED);
  });

  test("\"Other\" ticked with no description: blocked; with a description: completes", async () => {
    run([yes, work(OTHER)]);
    await expect(complete()).rejects.toThrow(BLOCKED);
    expect(T["assessments"]![0]!["status"]).toBe("in_progress");
    run([yes, work(OTHER), { label: FIXES_OTHER_LABEL, value: "Move a downlight away from the joist" }]);
    await complete();
    expect(T["assessments"]![0]!["status"]).toBe("complete");
  });
});
