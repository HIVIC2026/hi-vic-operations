import { describe, expect, it } from "vitest";
import { FIXES_PAY_FIRST, ownerFixesPickRefusal, ownerFixesStep } from "../src/lib/owner-fixes.core";

describe("block #11: fixes unpaid → plain pay-first reason", () => {
  it("unpaid accepted fixes refuse booking with Jo's pay-first words, not 'no times offered'", () => {
    const step = ownerFixesStep({ quoteStatus: "accepted", paid: false, pickable: 3, pickedAt: null, bookedAt: null });
    expect(step).toBe("pay");
    expect(ownerFixesPickRefusal(step)).toBe("Please pay for the electrical fixes before booking your install day.");
    expect(FIXES_PAY_FIRST).not.toMatch(/no times/i);
  });
  it("paid fixes with offered times can be picked", () => {
    expect(ownerFixesPickRefusal(ownerFixesStep({ quoteStatus: "accepted", paid: true, pickable: 1, pickedAt: null, bookedAt: null }))).toBeNull();
  });
});
