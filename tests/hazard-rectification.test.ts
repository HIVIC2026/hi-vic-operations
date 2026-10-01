import { describe, expect, test } from "bun:test";
import { evaluateHazardRectifications, rectFingerprint, type HazardVerification, type RectItem } from "../src/lib/hazard-rectification.core";
import { evaluatePiesa, HAZARD_UNRESOLVED } from "../src/lib/official-forms.core";

const answers = { "p7.flues": "Yes", "p7.appliance#0": "Fan", "p7.location#0": "Bath", "p7.hazard#0": "Heat", "p7.otherHazard#0": "Loose cable", "p7.otherAction#0": "Taped", "p7.effective": "No" };
const item: RectItem = { id: "r1", jobId: "j1", status: "completed", description: "Relocate fan", quantity: 1, rateCode: null };
const item2: RectItem = { ...item, id: "r2", description: "Re-terminate cable" };
const ver = (over: Partial<HazardVerification> = {}): HazardVerification => ({
  id: "v1", jobId: "j1", piesaCopyId: "pe1", hazardKey: "appliance#0", status: "current", rectificationItemId: "r1",
  rectificationFingerprint: rectFingerprint(item), verifiedBy: "office", verifiedAt: "2026-10-03T01:00:00Z", evidenceFileIds: ["f1"],
  cesRequired: false, cesNumber: null, cesEvidenceFileId: null, ...over,
});
const both = [ver(), ver({ id: "v2", hazardKey: "other#0", rectificationItemId: "r2", rectificationFingerprint: rectFingerprint(item2) })];
const run = (verifications: HazardVerification[], items: RectItem[] = [item, item2]) => {
  const r = evaluateHazardRectifications({ jobId: "j1", piesaCopyId: "pe1", answers, verifications, items });
  return { ...r, blocked: evaluatePiesa(answers, { hazardResolution: r.resolution }).blockers.some((b) => b.message === HAZARD_UNRESOLVED) };
};

describe("PIESA hazard → verified rectification", () => {
  test("positive: every hazard verified on the same job and PIESA clears the blocker", () => expect(run(both).blocked).toBe(false));
  test("attempted action alone (no record) blocks with next action", () => {
    const r = run([]); expect(r.blocked).toBe(true); expect(r.hazards).toHaveLength(2); expect(r.hazards[0]!.nextAction).toContain("verifies");
  });
  test("one hazard unresolved still blocks", () => expect(run([both[0]!]).blocked).toBe(true));
  test("wrong job verification is ignored", () => expect(run([ver({ jobId: "j2" }), both[1]!]).blocked).toBe(true));
  test("rectification item from a different job fails", () => expect(run(both, [{ ...item, jobId: "j2" }, item2]).hazards[0]!.reason).toContain("different job"));
  test("verification for an older PIESA copy is ignored", () => expect(run([ver({ piesaCopyId: "old" }), both[1]!]).blocked).toBe(true));
  test("superseded verification reopens", () => expect(run([ver({ status: "superseded" }), both[1]!]).blocked).toBe(true));
  test("changed rectification after verification reopens (stale)", () => {
    const r = run(both, [{ ...item, quantity: 2 }, item2]); expect(r.blocked).toBe(true); expect(r.hazards[0]!.reason).toContain("changed");
  });
  test("item no longer completed reopens", () => expect(run(both, [{ ...item, status: "required" }, item2]).blocked).toBe(true));
  test("no evidence or no verifier blocks", () => {
    expect(run([ver({ evidenceFileIds: [] }), both[1]!]).blocked).toBe(true);
    expect(run([ver({ verifiedBy: null }), both[1]!]).blocked).toBe(true);
  });
  test("CES: unanswered blocks; required needs number and copy", () => {
    expect(run([ver({ cesRequired: null }), both[1]!]).blocked).toBe(true);
    expect(run([ver({ cesRequired: true, cesNumber: "123" }), both[1]!]).blocked).toBe(true);
    expect(run([ver({ cesRequired: true, cesNumber: "123", cesEvidenceFileId: "c1" }), both[1]!]).blocked).toBe(false);
  });
  test("duplicate current verifications fail closed", () => expect(run([...both, ver({ id: "v3" })]).blocked).toBe(true));
  test("effective action needs no rectification", () => expect(evaluatePiesa({ ...answers, "p7.effective": "Yes" }).blockers.some((b) => b.message === HAZARD_UNRESOLVED)).toBe(false));
});
