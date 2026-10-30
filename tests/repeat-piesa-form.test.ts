import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ASSESSMENT_ROUND_RESET, piesaCompletionKind, repeatFormStep } from "../src/lib/repeat-piesa-form.core";
import { claimGeneration } from "../src/lib/mitti-create-claim.core";
const read = (p: string) => readFileSync(p, "utf8");
const old = { auditId: "m-first", status: "complete" };
describe("Repeat PIESA gets its own Mitti form (Jo 29 Oct 2026)", () => {
  test("first check moves to history once per lapsed deadline", () => {
    expect(repeatFormStep({ repeatDeadline: null, reset: null, current: old })).toBe("none");
    expect(repeatFormStep({ repeatDeadline: "2026-11-20", reset: null, current: old })).toBe("reset");
    expect(repeatFormStep({ repeatDeadline: "2026-11-20", reset: { previousAuditId: "m-first" }, current: old })).toBe("reset"); // crash replay
    expect(repeatFormStep({ repeatDeadline: "2026-11-20", reset: { previousAuditId: "m-first" }, current: { auditId: "m-repeat", status: "in_progress" } })).toBe("none"); // 2nd confirm / sync replay
    expect(repeatFormStep({ repeatDeadline: "2026-11-20", reset: { previousAuditId: "m-first" }, current: { auditId: null, status: "in_progress" } })).toBe("none");
  });
  test("claim moves to a new generation only for the PIESA form", () => {
    expect(claimGeneration({ releasedKinds: [], repeatResets: 0, kind: "piesa" })).toBe(0);
    expect(claimGeneration({ releasedKinds: ["piesa", "ready_check"], repeatResets: 1, kind: "piesa" })).toBe(2);
    expect(claimGeneration({ releasedKinds: ["piesa"], repeatResets: 1, kind: "ready_check" })).toBe(0);
  });
  test("completed repeat is a reassessment; first stays initial", () => {
    expect(piesaCompletionKind(0)).toBe("initial"); expect(piesaCompletionKind(1)).toBe("reassessment");
  });
  test("new round starts clean, including the first form's Mitti completion facts (fix round 1)", () => {
    expect(ASSESSMENT_ROUND_RESET).toEqual({
      status: "in_progress", completed_at: null, piesa_outcome: "pending", assessed_on: null, no_rectification_confirmed: null,
      external_mitti_id: null, mitti_template_id: null, mitti_raw_snapshot: null, mitti_sync_status: "not_synced", mitti_last_error: null,
      mitti_completed: false, mitti_synced_at: null, mitti_modified_at: null, mitti_validation_issues: [],
    });
  });
  test("a failed read of earlier PIESA records stops completion (never silently 'initial')", () => {
    const c = read("src/lib/piesa-complete.server.ts");
    const i = c.indexOf("error: priorError");
    expect(i).toBeGreaterThan(-1);
    expect(c.indexOf("if (priorError) throw new WorkflowError(", i)).toBeGreaterThan(i);
    expect(c.indexOf("if (priorError) throw new WorkflowError(")).toBeLessThan(c.indexOf("kind: piesaCompletionKind("));
  });
  test("wiring", () => {
    const s = read("src/lib/piesa-autoform.server.ts");
    expect(s.indexOf("await startRepeatRoundIfDue(")).toBeGreaterThan(-1);
    expect(s.indexOf("await startRepeatRoundIfDue(")).toBeLessThan(s.indexOf('admin.from("assessments").select("external_mitti_id")'));
    const fn = s.slice(s.indexOf("async function startRepeatRoundIfDue"));
    for (const x of ["repeatFormStep(", "repeatFormResetSeed(", "ASSESSMENT_ROUND_RESET", '.eq("status", "complete")', "internal: true"]) expect(fn).toContain(x);
    expect(read("src/lib/mitti-create.server.ts")).toContain("claimGeneration(");
    expect(read("src/lib/piesa-complete.server.ts")).toContain("kind: piesaCompletionKind(");
  });
});
