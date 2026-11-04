// G7 (Jo 4 Nov 2026 19:50, pack 2 batch 3, picture 11): My business › Insurance and licences — the APPROVED redraft.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INSURANCE_PAGE_WORDS, insuranceRowLabel, insuranceRowStatus } from "../src/lib/business-insurance.core";

const NOW = new Date("2026-11-04T05:00:00Z");
describe("the approved words", () => {
  test("top line, button, row names", () => {
    expect(INSURANCE_PAGE_WORDS.intro).toBe("Keep these current. If one runs out, you can't take new jobs, bookings or installs until the new certificate is uploaded and we've checked it. We'll remind you 30 days and 7 days before anything expires.");
    expect(INSURANCE_PAGE_WORDS.upload).toBe("Upload a new certificate");
    expect(insuranceRowLabel("public_liability_insurance", "Public Liability")).toBe("Public liability");
    expect(insuranceRowLabel("workers_comp_insurance", "Workers Comp")).toBe("Workers comp");
    expect(insuranceRowLabel("other", "Something else")).toBe("Something else");
  });
  test("row states: checked → 'Checked · current until {date}'; unchecked → 'Waiting for us to check'; expired → 'Expired {date} — upload the new one' (wins)", () => {
    expect(insuranceRowStatus({ verified: true, expires: "2026-11-19" }, NOW)).toEqual({ line: "Checked · current until Thu 19 Nov 2026", warn: false });
    expect(insuranceRowStatus({ verified: false, expires: "2026-11-19" }, NOW)).toEqual({ line: "Waiting for us to check", warn: true });
    expect(insuranceRowStatus({ verified: true, expires: "2026-10-20" }, NOW)).toEqual({ line: "Expired Tue 20 Oct 2026 — upload the new one", warn: true });
    expect(insuranceRowStatus({ verified: false, expires: "2026-10-20" }, NOW)).toEqual({ line: "Expired Tue 20 Oct 2026 — upload the new one", warn: true });
    expect(insuranceRowStatus({ verified: true, expires: null }, NOW)).toEqual({ line: INSURANCE_PAGE_WORDS.checkedNoDate, warn: true });
  });
  test("the page uses the core words and none of the old lines", () => {
    const src = readFileSync("src/routes/_authenticated/field.business_.insurance.tsx", "utf8");
    expect(src).toContain("INSURANCE_PAGE_WORDS.intro");
    expect(src).toContain("INSURANCE_PAGE_WORDS.upload");
    expect(src).toContain("insuranceRowStatus(");
    expect(src).toContain("insuranceRowLabel(");
    for (const old of ["Keep these current to keep receiving job offers", "Checked by the office", "Waiting for the office to check", "Upload a renewed certificate", "expiryPill"]) expect(src).not.toContain(old);
  });
});
