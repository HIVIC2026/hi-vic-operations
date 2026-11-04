import { describe, expect, test } from "bun:test";
import { INSTALLER_AGREEMENT_SECTIONS } from "../src/lib/installer-agreement.text";
import { REC_AGREEMENT_SECTIONS } from "../src/lib/rec-agreement.text";

const all = (s: { paras: string[] }[]) => s.flatMap((x) => x.paras).join("\n");
const deadline = "within 2 business days, attend the property within 5 business days (or within 24 hours if there is a safety risk), and finish the correction within 15 business days";

describe("partner agreements: defect deadlines and direct electrical upgrades (Jo 4 Nov 2026)", () => {
  test("installer and REC defect clauses carry the 2/5/15 business-day deadlines", () => {
    for (const t of [all(INSTALLER_AGREEMENT_SECTIONS), all(REC_AGREEMENT_SECTIONS)]) {
      expect(t).toContain(deadline);
      expect(t).not.toContain("at its own cost within a reasonable time after notice");
    }
  });
  test("REC quotes, invoices and is paid for electrical upgrades directly by the owner", () => {
    const t = all(REC_AGREEMENT_SECTIONS);
    expect(t).toContain("The REC quotes the owner for electrical upgrades directly, invoices the owner directly and collects payment directly.");
    expect(t).not.toContain("must not provide the owner with a competing direct quote, invoice the owner directly");
    expect(t).not.toContain("rectification quote");
  });
  test("REC may phone the owner to book", () => {
    const t = all(REC_AGREEMENT_SECTIONS);
    expect(t).toContain("The REC may contact the owner by phone or message to book the PIESA and electrical upgrades");
    expect(t).not.toContain("Phone calls, direct text messages and outside messaging are not permitted");
  });
});
