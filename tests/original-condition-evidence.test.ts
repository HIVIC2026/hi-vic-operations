import { describe, expect, mock, test } from "bun:test";
import { intakeOriginalConditionMedia, rebateEvidenceBlockers, type EvidenceItem } from "../src/lib/installer-intake.core";
import { rcProgress } from "../src/lib/ready-check-draft.core";

const item = (category: string, status: string, label = category): EvidenceItem => ({ category, label, blocking: true, status });
const gate = (existing: string | null, items: EvidenceItem[]) => {
  const m = intakeOriginalConditionMedia(existing);
  return [...(m.blocker ? [m.blocker] : []), ...rebateEvidenceBlockers({ items, apApprovedBy: "u-admin", requiredCategories: m.required, notApplicableCategories: m.notApplicable })];
};

describe("original-condition evidence applicability (final verified gate)", () => {
  test("None: empty-ceiling media verified is enough; the existing R-value item is never forced", () => {
    expect(gate("none", [item("before_ceiling_space", "verified"), item("existing_insulation_r_value", "outstanding")])).toEqual([]);
  });
  test("None: the empty-ceiling media must still be VERIFIED", () => {
    expect(gate("none", [item("before_ceiling_space", "uploaded")]).join()).toContain("not verified");
  });
  test("Below R2 / present (including mixed ceilings): verified R-value/depth media is required", () => {
    const b = gate("present", [item("before_ceiling_space", "verified"), item("existing_insulation_r_value", "uploaded")]);
    expect(b.some((x) => x.includes("existing insulation r value"))).toBe(true);
    expect(gate("present", [item("before_ceiling_space", "verified"), item("existing_insulation_r_value", "verified")])).toEqual([]);
  });
  test("Not recorded / unknown fails closed with both items required", () => {
    expect(gate(null, [item("before_ceiling_space", "verified"), item("existing_insulation_r_value", "verified")])).toEqual(["Existing insulation (none / present) is not recorded in the Ready Check"]);
    expect(gate("unknown", [item("before_ceiling_space", "verified")]).length).toBeGreaterThan(1);
  });
  test("Ready Check screen does not list the R-value photo as missing for an empty ceiling", () => {
    const ev = [{ label: "Existing R", gate: "assessment", required: true, status: "outstanding", category: "existing_insulation_r_value" }];
    expect(rcProgress({ "insulation.existing": "none" }, ev).evidence.missing).toEqual([]);
    expect(rcProgress({ "insulation.existing": "present" }, ev).evidence.missing).toEqual(["Existing R"]);
  });
});

describe("work-start lock uses the live original-condition answers", () => {
  test("PIISA send / install evidence refused while original-condition answers are missing", async () => {
    const real = await import("../src/lib/ready-check-draft.server");
    let block = true; // scoped: other test files sharing this process see the real behaviour afterwards
    mock.module("@/lib/ready-check-draft.server", () => ({ ...real, rcWorksBlockers: async (id: string) => (block ? ["Existing insulation", "Removal required"] : real.rcWorksBlockers(id)) }));
    const { requirePrestartClear } = await import("../src/lib/prestart.server");
    try { await expect(requirePrestartClear("job-1")).rejects.toThrow("record the original ceiling condition"); } finally { block = false; }
  });
});
