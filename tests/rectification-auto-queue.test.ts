import { describe, it, expect } from "vitest";
import { rectQuoteIsStandardOnly, rectAutoQueueDecision } from "../src/lib/rectification.core";

describe("rectification auto-queue vs hold", () => {
  const standard = [{ is_other: false, needs_office_pricing: false }, { is_other: false, needs_office_pricing: false }];
  const withOther = [{ is_other: false, needs_office_pricing: false }, { is_other: true, needs_office_pricing: false }];
  const withPricing = [{ is_other: false, needs_office_pricing: true }];

  it("standard-only lines qualify", () => expect(rectQuoteIsStandardOnly(standard, false)).toBe(true));
  it("an 'Other' line disqualifies", () => expect(rectQuoteIsStandardOnly(withOther, false)).toBe(false));
  it("a needs_office_pricing line disqualifies", () => expect(rectQuoteIsStandardOnly(withPricing, false)).toBe(false));
  it("a manually adjusted quote always disqualifies", () => expect(rectQuoteIsStandardOnly(standard, true)).toBe(false));
  it("no items disqualifies (never auto-queue an empty quote)", () => expect(rectQuoteIsStandardOnly([], false)).toBe(false));

  it("switch off always holds, even for standard-only lines", () => expect(rectAutoQueueDecision(false, standard, false)).toBe("hold"));
  it("switch on + standard-only auto-queues", () => expect(rectAutoQueueDecision(true, standard, false)).toBe("auto_queue"));
  it("switch on + other/non-standard still holds", () => expect(rectAutoQueueDecision(true, withOther, false)).toBe("hold"));
  it("switch on + manually adjusted still holds", () => expect(rectAutoQueueDecision(true, standard, true)).toBe("hold"));
});
