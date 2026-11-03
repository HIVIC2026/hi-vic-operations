// Part 3 Task 1 (Jo 2 Nov 2026): electricians quote, book and bill the electrical upgrades on EVERY job. Pure rules only.
import { describe, expect, test } from "bun:test";
import { ELECTRICIAN_BILLS_SKIP, UPGRADES_BILLED_BY_ELECTRICIAN, UPGRADES_QUOTE_SEND_BLOCKER, electricianBillsUpgrades } from "../src/lib/upgrades-billing.core";
import { partnerBillsRectification } from "../src/lib/in-house.core";
import { electricalClearance, rectificationSendBlocker, rectificationVisitBlocker } from "../src/lib/allocation.core";

describe("electricianBillsUpgrades", () => {
  test("is true for every job: HIV lead, installer's own job, in-house partner, nothing at all", () => {
    expect(electricianBillsUpgrades()).toBe(true);
    expect(electricianBillsUpgrades({ channel: "hivic_sourced", in_house: false })).toBe(true);
    expect(electricianBillsUpgrades({ channel: "installer_sourced" })).toBe(true);
    expect(electricianBillsUpgrades({ in_house: true, rectification_billed_by: "hivic" })).toBe(true);
    expect(electricianBillsUpgrades(null)).toBe(true);
  });
  test("the wording constants are exactly the agreed lines", () => {
    expect(UPGRADES_BILLED_BY_ELECTRICIAN).toBe("Your electrician quotes and arranges the electrical upgrades with you directly.");
    expect(UPGRADES_QUOTE_SEND_BLOCKER).toBe("Electricians bill upgrades directly.");
    expect(ELECTRICIAN_BILLS_SKIP).toBe("electrician_bills");
  });
});

describe("the in-house 'partner bills rectification' mode is now every job", () => {
  test("partnerBillsRectification delegates to the predicate — true whatever the business columns say", () => {
    expect(partnerBillsRectification({ in_house: true, rectification_billed_by: "partner" })).toBe(true);
    expect(partnerBillsRectification({ in_house: false, rectification_billed_by: "partner" })).toBe(true);
    expect(partnerBillsRectification({ in_house: true, rectification_billed_by: "hivic" })).toBe(true);
    expect(partnerBillsRectification({ in_house: false, rectification_billed_by: "hivic" })).toBe(true);
  });
});

describe("electricalClearance never needs an HIV upgrades quote", () => {
  const base = { piesaOutcome: "fail" as const, piesaCompletedAt: "2026-11-02", rectificationRequired: true, rectificationQuoteAccepted: false, rectificationCompletedAt: null, sectionCSignedAt: null };
  test("HIV lead with upgrades needed, no quote: not blocked on the quote (the Part C still gates it, unchanged)", () => {
    const c = electricalClearance(base);
    expect(c.cleared).toBe(false);
    expect(c.blocker).not.toContain("approved the electrical fixes quote");
    expect(c.blocker).toBe("Electrical fixes not completed yet.");
  });
  test("on-site-at-install-start job with no quote or payment: clears on the PIESA alone (electrician_at_start, no Section C)", () => {
    const c = electricalClearance({ ...base, onsiteStartOnly: true, fixesPaymentCleared: false });
    expect(c).toMatchObject({ cleared: true, basis: "electrician_at_start", timingDate: "2026-11-02", blocker: null });
  });
  test("upgrades done + Part C signed clears on the Part C basis with the 30 days from the PIESA date", () => {
    const c = electricalClearance({ ...base, rectificationCompletedAt: "2026-11-05", sectionCSignedAt: "2026-11-05" });
    expect(c).toMatchObject({ cleared: true, basis: "section_c", timingDate: "2026-11-02" });
  });
  test("a PIESA pass with no upgrades still clears straight away (unchanged)", () => {
    expect(electricalClearance({ ...base, piesaOutcome: "pass", rectificationRequired: false }).cleared).toBe(true);
  });
});

describe("the upgrades visit and the office Send button", () => {
  test("rectificationVisitBlocker never asks for the owner's approval of a quote", () => {
    expect(rectificationVisitBlocker({ quoteAccepted: false, recActiveApproved: true })).toBeNull();
    expect(rectificationVisitBlocker({ quoteAccepted: false, recActiveApproved: false })).toBe("The PIESA electrician is no longer approved/active — office must arrange another REC.");
  });
  test("rectificationSendBlocker refuses to send any upgrades quote, even an office-reviewed draft", () => {
    const q = { kind: "rectification", status: "draft", office_reviewed_at: "2026-11-02", has_unpriced_items: false };
    expect(rectificationSendBlocker(q, true)).toBe(UPGRADES_QUOTE_SEND_BLOCKER);
    expect(rectificationSendBlocker(q, false)).toBe(UPGRADES_QUOTE_SEND_BLOCKER);
  });
  test("rectificationSendBlocker ignores installation quotes (unchanged)", () => {
    expect(rectificationSendBlocker({ kind: "installation", status: "draft", office_reviewed_at: null, has_unpriced_items: false }, false)).toBeNull();
  });
});
