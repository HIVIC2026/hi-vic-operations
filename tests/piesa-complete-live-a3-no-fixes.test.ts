// C4 (Jo 28 Oct 2026): the portal "No electrical fixes required" tick is gone, so a live A3 pass with no fixes items completes
// without it. Every other case keeps the old error. Runs the real completePiesaAssessment against a small fake database.
import { describe, expect, mock, test } from "bun:test";
import { A3_REPAIR_NEEDED_LABEL } from "../src/lib/official-short.core";

let assessment: Record<string, unknown> = {};
let rectItems = 0;
const rows = (t: string) => t === "assessments" ? assessment : null;
const builder = (t: string) => {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  for (const m of ["select", "eq", "in", "neq", "order", "limit"]) b[m] = chain;
  b["maybeSingle"] = async () => ({ data: rows(t), error: null });
  b["single"] = async () => ({ data: rows(t), error: null });
  b["then"] = (res: (v: unknown) => unknown) => res({ data: [], count: t === "rectification_items" ? rectItems : 0, error: null });
  return b;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: builder, rpc: async () => ({ data: null, error: null }) } }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, logEvent: async () => {}, stageEntryBlockers: async () => [], transition: async () => {}, getStage: async () => "installation_booked" }));
mock.module("../src/lib/requirements.server", () => ({ jobScope: async () => ({ scope: "x", label: "x" }), advanceSiteRequirements: async () => ({ advanced: false, scope: "x" }) }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null }));
mock.module("../src/lib/piesa-evidence.core", () => ({ piesaEvidenceBlockersFromSnapshot: () => [] }));

const { completePiesaAssessment } = await import("../src/lib/piesa-complete.server");
const FIXES_ERROR = /No electrical fixes required/;
const WRONG_STAGE = /can be completed once it is booked/; // reached only after the fixes check has passed
const base = { id: "a1", status: "draft", external_mitti_id: "m1", life_support_confirmed: false, assessed_on: "2026-10-01", no_rectification_confirmed: null };
const live = (repairNeeded: "Yes" | "No") => [{ label: A3_REPAIR_NEEDED_LABEL, value: repairNeeded }];
const run = async () => { try { await completePiesaAssessment({ jobId: "j1" }, "u1"); return ""; } catch (e) { return (e as Error).message; } };

describe("Complete PIESA: live A3 'no fixes' (C4)", () => {
  test("live A3 pass with no fixes items passes the fixes check with no tick", async () => {
    assessment = { ...base, piesa_outcome: "pass", mitti_raw_snapshot: live("No") }; rectItems = 0;
    const err = await run();
    expect(err).not.toMatch(FIXES_ERROR);
    expect(err).toMatch(WRONG_STAGE);
  });
  test("live A3 fail with no items and no A4 price still errors", async () => {
    assessment = { ...base, piesa_outcome: "fail", mitti_raw_snapshot: live("Yes") }; rectItems = 0;
    expect(await run()).toMatch(FIXES_ERROR);
  });
  test("an older (non-live) form with no tick still errors, even on a pass", async () => {
    assessment = { ...base, piesa_outcome: "pass", mitti_raw_snapshot: [{ label: "Switchboard condition", value: "ok" }], switchboard_condition: "ok", rcds_present: true }; rectItems = 0;
    expect(await run()).toMatch(FIXES_ERROR);
  });
  test("ticked plus items listed is still an error", async () => {
    assessment = { ...base, piesa_outcome: "pass", mitti_raw_snapshot: live("No"), no_rectification_confirmed: true }; rectItems = 2;
    expect(await run()).toMatch(/You ticked/);
  });
});
