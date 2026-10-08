import { expect, test } from "bun:test";
import { evaluatePiisa } from "../src/lib/official-forms.core";
import { buildOfficialPrefill, missingKnownFields } from "../src/lib/mitti.core";
import { PIISA_A3_MAPPING } from "../src/lib/piisa-a3.core";

const rules = (a: Record<string, unknown>, ctx = {}) => evaluatePiisa(a as never, ctx).blockers.map((b) => b.rule);

test("solar instructions No requires electrician; N/A rejected", () => {
  const r = rules({ "p4.present": "Yes", "p4.instructions": "No", "p5.electricianPresent": "N/A" });
  expect(r).toContain("ELECTRICIAN-AT-START");
  expect(r).toContain("ELECTRICIAN-NA-INVALID");
});
test("isolator No alone no longer triggers the electrician rule", () => {
  expect(rules({ "p4.present": "Yes", "p4.instructions": "Yes", "p4.isolator": "No" })).not.toContain("ELECTRICIAN-AT-START");
});
test("signed PIESA attendance requirement triggers it", () => {
  expect(rules({ "p5.electricianPresent": "N/A" }, { electricianRequiredAtStart: true })).toContain("ELECTRICIAN-NA-INVALID");
});
test("unsuitable blocks top-up only, not complete removal", () => {
  expect(rules({ "p6.present": "Yes", "p6.suitable": "No", "p6.treatment": ["Removed", "Topped Up"] })).toContain("P6-UNSUITABLE-TOPUP");
  expect(rules({ "p6.present": "Yes", "p6.suitable": "No", "p6.treatment": ["Removed"] })).not.toContain("P6-UNSUITABLE-TOPUP");
});
test("mixed Removed + Topped Up still needs the retention reason", () => {
  const msgs = evaluatePiisa({ "p6.present": "Yes", "p6.treatment": ["Removed", "Topped Up"] } as never).blockers.map((b) => b.message).join(" ");
  expect(msgs).toMatch(/not removed, what is the reason/i);
});
test("alias mapping matches a simplified native label; unknown fields fail visibly", () => {
  const template = { header_items: [], items: [{ item_id: "x1", label: "What is the average depth of the existing insulation (mm)?", type: "text" }] };
  const p = buildOfficialPrefill(template, [{ itemId: "p6.height", label: "What is the average height of the existing insulation?", kind: "number", value: "80", occurrence: 0 }, { itemId: "p2.lead", label: "Lead installer name:", kind: "text", value: "A", occurrence: 0 }] as never, PIISA_A3_MAPPING);
  expect(p.count).toBe(1);
  expect(missingKnownFields(p.skipped)).toEqual(["p2.lead (not on the Mitti form)"]);
});
