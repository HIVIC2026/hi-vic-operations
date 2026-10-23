// Jo 23 Oct 02:49: renamed product question, R-value pick list, longer Site address label, A2 no-pricing tick.
import { describe, expect, it } from "bun:test";
import { parseAudit, contactAnswersFromEntries } from "../src/lib/mitti.core";
import { parsePickupAudit } from "../src/lib/mitti-pickup.core";
import { readyCheckStopReasons, STOP_R2 } from "../src/lib/ready-check-answers.core";

let n = 0;
const it_ = (label: string, v: string | string[] | null, parent: string | null = null, header = false) =>
  ({ item_id: `i${n++}`, label, parent_id: parent, header, responses: v == null ? {} : Array.isArray(v) ? { selected: v.map((l) => ({ label: l })) } : { text: v } });
const audit = (rv: string, extra: unknown[] = []) => ({
  audit_id: "audit_TEST", template_id: "template_01ee0428be6d4435b34d8b738935f099",
  header_items: [it_("Site address (please edit street number if incorrect address shows)", "1 TEST St, Testville VIC 3000", null, true)],
  items: [{ item_id: "A", label: "── Ceiling Area 1 ──" }, it_("Enter the measured ceiling area (m²)", "120", "A"), it_("Is there existing insulation in this ceiling area?", ["Yes"], "A"),
    it_("What is the determined R value of the existing ceiling insulation?", [rv], "A"), ...extra],
});

describe("Mitti reading fixes 23 Oct", () => {
  it("reads the renamed product question and still the old one", () => {
    expect(contactAnswersFromEntries([{ label: "What insulation product will you be using on this job?", value: "Bradford Gold R6" }]).productOption).toBe("Bradford Gold R6");
    expect(contactAnswersFromEntries([{ label: "Insulation product", value: "Fletchers Pink Batts R5" }]).productOption).toBe("Fletchers Pink Batts R5");
  });
  it("Below R2.0 is OK with no number error", () => {
    const p = parseAudit(audit("Below R2.0"));
    expect(p.issues.some((i) => /not a valid number/.test(i))).toBe(false);
    expect(readyCheckStopReasons(p.snapshot)).toEqual([]);
  });
  it("Above R2.0 is the R2-or-above stop, with no number error", () => {
    const p = parseAudit(audit("Above R2.0"));
    expect(p.issues.some((i) => /not a valid number/.test(i))).toBe(false);
    expect(readyCheckStopReasons(p.snapshot)).toContain(STOP_R2);
  });
  it("numbers are still accepted", () => expect(parseAudit(audit("2.5")).patch.existing_r_value).toBe(2.5));
  it("pickup reads the longer Site address label", () => expect(parsePickupAudit(audit("Below R2.0"))?.siteAddress).toBe("1 TEST St, Testville VIC 3000"));
  it("records the A2 no-pricing tick on the Ready Check record", () => {
    const p = parseAudit(audit("Below R2.0", [it_("I confirm I have not discussed or agreed pricing with the homeowner during this Ready Check. All quotes and pricing discussions will be handled directly by Home Insulation Victoria", ["Yes"])]));
    expect(p.patch.notes).toContain("Installer confirmed pricing not discussed or agreed with the homeowner: Yes");
  });
});
