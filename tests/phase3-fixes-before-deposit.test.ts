// Phase 3 path 2 (Jo 27 Oct 2026): a PIESA that found electrical fixes never reads "PIESA passed" for the office, and the
// owner is not asked for the 10% install deposit until the fixes are signed off (locked order: fixes → deposit → install).
import { describe, expect, test } from "bun:test";
import { installDepositDueNow } from "../src/lib/payments.core";

describe("10% deposit waits for the fixes", () => {
  test("PIESA found fixes, no Section C → deposit not due", () => {
    expect(installDepositDueNow("piesa_complete", { outcome: "fail", section_c_signed_at: null })).toBe(false);
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
