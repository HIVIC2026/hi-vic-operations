import { describe, expect, test } from "bun:test";
import { missingTasks } from "../src/lib/installer-missing-tasks.core";

describe("missing-only task lists", () => {
  const ev = [
    { label: "Before photos — zone 1", status: "outstanding", gate: "assessment" },
    { label: "After photos — zone 1", status: "uploaded", gate: "installation" },
    { label: "No insulation — removal photos", status: "not_required", gate: "installation" },
    { label: "Verified roof photo", status: "verified", gate: "assessment" },
    { label: "Legacy item", status: "outstanding", gate: null },
  ];
  test("groups only open items by the step they block; N/A and verified never listed", () => {
    const m = missingTasks({ quoteBlockers: ["Confirm the price basis"], worksBlockers: ["Existing insulation"], siteHoldBlocker: null, evidence: ev });
    expect(m.quote).toEqual(["Confirm the price basis"]);
    expect(m.beforeStart).toEqual(["Record the original condition: Existing insulation", "Before photos — zone 1"]);
    expect(m.afterCompletion).toEqual(["After photos — zone 1"]); // uploaded but not yet verified still counts as missing acceptance
    expect(m.unknown).toEqual(["Legacy item"]);
  });
  test("open site hold appears first for the quote and before start", () => {
    const h = "Site conditions differ — office review required before the quote or works can continue: extra void";
    const m = missingTasks({ quoteBlockers: [h, "x"], worksBlockers: [], siteHoldBlocker: h, evidence: [] });
    expect(m.quote).toEqual([h, "x"]); expect(m.beforeStart).toEqual([h]);
  });
});
