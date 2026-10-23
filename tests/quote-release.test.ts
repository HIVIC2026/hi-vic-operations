import { describe, expect, test } from "bun:test";
import { confirmedQuoteDecision, currentEstimateTotal, installerPriceRangeReason, rectificationQuoteDecision } from "../src/lib/quote-release.core";

describe("automatic quote release", () => {
  test("confirmed quote within 15% still needs office review even with sending enabled", () => {
    expect(confirmedQuoteDecision({ estimateTotal: 1000, quoteTotal: 1150, tolerancePct: 15, hasUnratedExtras: false, externalSendingEnabled: true })).toEqual({ state: "held", reason: "Waiting for office review before sending", status: "draft" });
  });
  test("confirmed quote over 15% holds with a plain reason", () => {
    expect(confirmedQuoteDecision({ estimateTotal: 1000, quoteTotal: 1180, tolerancePct: 15, hasUnratedExtras: false, externalSendingEnabled: true })).toEqual({ state: "held", reason: "Quote held: price up 18% on estimate", status: "draft" });
  });
  test("an unrated extra holds", () => {
    expect(confirmedQuoteDecision({ estimateTotal: 1000, quoteTotal: 1000, tolerancePct: 15, hasUnratedExtras: true, externalSendingEnabled: true }).reason).toContain("not on the agreed rate card");
  });
  test("standard fix-up releases and non-standard or manual pricing holds", () => {
    expect(rectificationQuoteDecision({ hasNonStandardItem: false, manuallyPriced: false, externalSendingEnabled: true }).state).toBe("held");
    expect(rectificationQuoteDecision({ hasNonStandardItem: true, manuallyPriced: false, externalSendingEnabled: true }).state).toBe("held");
    expect(rectificationQuoteDecision({ hasNonStandardItem: false, manuallyPriced: true, externalSendingEnabled: true }).state).toBe("held");
  });
  test("switches off queue both quote kinds without issuing", () => {
    expect(confirmedQuoteDecision({ estimateTotal: 1000, quoteTotal: 1000, tolerancePct: 15, hasUnratedExtras: false, externalSendingEnabled: false })).toEqual({ state: "held", reason: "Waiting for office review before sending", status: "draft" });
    expect(rectificationQuoteDecision({ hasNonStandardItem: false, manuallyPriced: false, externalSendingEnabled: false })).toEqual({ state: "held", reason: "Waiting for office review before sending", status: "draft" });
  });
  test("installer range is optional and inclusive", () => {
    expect(installerPriceRangeReason(42, null, null)).toBeNull();
    expect(installerPriceRangeReason(30, 30, 50)).toBeNull();
    expect(installerPriceRangeReason(55, 30, 50)).toContain("above the normal range");
  });
  test("reads the current estimate total from its stored customer scenario", () => {
    const scenarios = [{ key: "can_remain", by_access: { standard: { estimated_customer_total: 3379 } } }, { key: "full_removal", by_access: { standard: { estimated_customer_total: 5629 } } }];
    expect(currentEstimateTotal(scenarios)).toBe(3379);
    expect(currentEstimateTotal(scenarios, true)).toBe(5629);
    expect(currentEstimateTotal(null)).toBeNull();
  });
});