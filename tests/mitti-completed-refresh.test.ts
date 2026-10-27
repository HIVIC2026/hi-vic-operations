import { describe, expect, test } from "bun:test";
import { completedRefreshPlan, completedQuoteCanRedraft } from "../src/lib/mitti-completed-refresh.core";
const current = { id: "m1", status: "complete", external_source: "mitti", external_id: "a1", raw_snapshot: [{ label: "Remove", value: "No" }] };
const input = { current, auditId: "a1", completed: true, snapshot: [{ label: "Remove", value: "75" }], values: { measured_area_m2: 75, removal_required: true, removal_m2: 75, access_difficulty: "easy" }, zones: [] };
describe("edited completed Ready Checks", () => {
  test("75m² removal added after Complete refreshes the measurement", () => {
    expect(completedRefreshPlan(input)).toMatchObject({ measured_area_m2: 75, removal_required: true, removal_m2: 75, access_difficulty: "easy" });
    expect(completedRefreshPlan({ ...input, current: { ...current, raw_snapshot: input.snapshot } })).toBeNull();
  });
  test("cleared removal does not retain the old area", () => expect(completedRefreshPlan({ ...input, values: { removal_required: false } })).toMatchObject({ removal_required: false, removal_m2: null, access_difficulty: null }));
  test("accepted measurements and other forms are not overwritten", () => {
    expect(completedRefreshPlan({ ...input, current: { ...current, accepted_by: "office" } })).toBeNull();
    expect(completedRefreshPlan({ ...input, current: { ...current, verified_area_m2: 75 } })).toBeNull();
    expect(completedRefreshPlan({ ...input, auditId: "other" })).toBeNull();
  });
  test("redraft held or absent quotes only, never sent or accepted", () => {
    expect(completedQuoteCanRedraft([])).toBe(true);
    expect(completedQuoteCanRedraft([{ status: "draft", release_state: "held" }])).toBe(true);
    expect(completedQuoteCanRedraft([{ status: "issued" }])).toBe(false);
    expect(completedQuoteCanRedraft([{ status: "accepted" }])).toBe(false);
    expect(completedQuoteCanRedraft([{ status: "draft", release_state: "held", sent_at: "2026-10-27" }])).toBe(false);
  });
});