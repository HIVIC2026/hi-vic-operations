// Night test run 25 Oct 2026 (A1 journey findings): the live A3 PIESA form's own answers fill the PIESA result and the
// life support fact, so "Complete PIESA" is no longer refused forever; older forms keep their B1 reading.
import { describe, expect, test } from "bun:test";
import { parseAudit } from "../src/lib/mitti.core";
import { A3_REPAIR_NEEDED_LABEL, LIFE_SUPPORT_PRESENT, isLiveA3Snapshot } from "../src/lib/official-short.core";

const q = (label: string, answer: string) => ({ item_id: label.slice(0, 12), label, type: "question", responses: { selected: [{ label: answer }] } });
const audit = (...items: unknown[]) => ({ audit_id: "audit_1", template_id: "template_x", items });

describe("live A3 PIESA result (night run 25 Oct 2026)", () => {
  test("repair work needed = Yes → PIESA outcome fail (rectification required)", () => {
    const r = parseAudit(audit(q(A3_REPAIR_NEEDED_LABEL, "Yes"), q(LIFE_SUPPORT_PRESENT, "No")));
    expect(r.patch.piesa_outcome).toBe("fail");
    expect(r.patch.life_support_confirmed).toBe(false);
  });
  test("repair work needed = No → pass, but the 'No electrical fixes required' tick is never pre-filled", () => {
    const r = parseAudit(audit(q(A3_REPAIR_NEEDED_LABEL, "No")));
    expect(r.patch.piesa_outcome).toBe("pass");
    expect((r.patch as Record<string, unknown>)["no_rectification_confirmed"]).toBeUndefined();
  });
  test("unanswered → stays pending with an issue; an old B1 'not required' is still only preliminary", () => {
    expect(parseAudit(audit()).patch.piesa_outcome).toBeUndefined();
    const b1 = parseAudit(audit(q("B1 Assessment outcome", "Rectification work is not required")));
    expect(b1.patch.piesa_outcome).toBeUndefined();
    expect(b1.issues.join(" ")).toContain("preliminary B1 only");
  });
  test("isLiveA3Snapshot: only a stored snapshot that answered the Yes/No repair question", () => {
    expect(isLiveA3Snapshot([{ label: A3_REPAIR_NEEDED_LABEL, value: "Yes" }])).toBe(true);
    expect(isLiveA3Snapshot([{ label: `${A3_REPAIR_NEEDED_LABEL}\nHelp text`, value: "No" }])).toBe(true);
    expect(isLiveA3Snapshot([{ label: `Help first\n${A3_REPAIR_NEEDED_LABEL}`, value: "No" }])).toBe(false);
    expect(isLiveA3Snapshot([{ label: A3_REPAIR_NEEDED_LABEL, value: null }])).toBe(false);
    expect(isLiveA3Snapshot([{ label: "B1 Assessment outcome", value: "x" }])).toBe(false);
    expect(isLiveA3Snapshot(null)).toBe(false);
  });
});
