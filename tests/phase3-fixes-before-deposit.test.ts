// Phase 3 path 2 (Jo 27 Oct 2026): a PIESA that found electrical fixes never reads "PIESA passed" for the office.
// Jo 2 Nov 2026 (answer 21) replaced the "deposit waits for the fixes" order: the deposit is due straight after the PIESA result.
import { describe, expect, test } from "bun:test";
import { installDepositDueNow } from "../src/lib/payments.core";

describe("10% deposit is due straight after the PIESA result", () => {
  test("PIESA found upgrades, no Section C yet → deposit due (answer 21)", () => {
    expect(installDepositDueNow("piesa_complete", { outcome: "fail", section_c_signed_at: null })).toBe(true);
  });
  test("PIESA passed → deposit due", () => {
    expect(installDepositDueNow("piesa_complete", { outcome: "pass", section_c_signed_at: null })).toBe(true);
  });
  test("fixes signed off (Section C) → deposit due", () => {
    expect(installDepositDueNow("piesa_complete", { outcome: "fail", section_c_signed_at: "2026-10-28T00:00:00Z" })).toBe(true);
  });
  test("install scheduling → deposit due; earlier stages → not due", () => {
    expect(installDepositDueNow("installation_scheduling", null)).toBe(true);
    expect(installDepositDueNow("piesa_scheduled", null)).toBe(false);
  });
});

import { officeStatus } from "../src/lib/office-status.core";
describe("office label after a PIESA that found fixes", () => {
  const f = (piesa: { completedAt: string | null; passed: boolean; sectionCAt: string | null }) =>
    officeStatus({ id: "j", stage: "piesa_complete", createdAt: "2026-10-01T00:00:00Z", lastActivityAt: "2026-10-27T00:00:00Z", enteredStageAt: "2026-10-27T00:00:00Z", piesa } as never, Date.parse("2026-10-27T01:00:00Z"));
  test("fixes found → not 'PIESA passed'", () => {
    expect(f({ completedAt: "2026-10-27", passed: false, sectionCAt: null })?.label).toBe("PIESA found electrical fixes");
  });
  test("pass → 'PIESA passed'", () => {
    expect(f({ completedAt: "2026-10-27", passed: true, sectionCAt: null })?.label).toBe("PIESA passed");
  });
});

import { xeroPaymentsListComplete } from "../src/lib/payments.core";
describe("Xero payment deleted → reversed, not still paid", () => {
  test("Payments left out with nothing paid = complete empty list (reversal allowed)", () => {
    expect(xeroPaymentsListComplete(undefined, 0, 0)).toBe(true);
  });
  test("Payments left out while Xero still shows money paid = partial (no reversal)", () => {
    expect(xeroPaymentsListComplete(undefined, 0, 34900)).toBe(false);
  });
  test("listed payments cover the amount = complete", () => {
    expect(xeroPaymentsListComplete([{}], 34900, 34900)).toBe(true);
  });
});
