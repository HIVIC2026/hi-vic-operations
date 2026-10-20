import { expect, test } from "bun:test";
import { missingTasks, DUE_BEFORE_DISTURBANCE, DUE_AFTER_COMPLETION } from "../src/lib/installer-missing-tasks.core";
test("original condition is due before removal/covering; completion evidence before AP review; done items hidden", () => {
  const t = missingTasks({ quoteBlockers: [], worksBlockers: ["ceiling photos"], siteHoldBlocker: null, evidence: [
    { label: "After photos", status: "missing", gate: "installation" }, { label: "Removal photos", status: "not_required", gate: "installation" }] });
  expect(t.beforeStart).toEqual([`Record the original condition: ceiling photos — ${DUE_BEFORE_DISTURBANCE}`]);
  expect(t.afterCompletion).toEqual([`After photos — ${DUE_AFTER_COMPLETION}`]);
});
