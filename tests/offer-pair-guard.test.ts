import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { offerPairBlocker } from "../src/lib/test-send.core";

const testBiz = { onboarding_notes: "[TEST PARTNER] TEST Alpha" };
const realBiz = { onboarding_notes: "Deep's real business" };
describe("offer pairing: TEST jobs ↔ TEST partners only", () => {
  test("TEST job → TEST partner allowed, real partner refused", () => {
    expect(offerPairBlocker(testBiz, "qa_test")).toBeNull();
    expect(offerPairBlocker(realBiz, "qa_test")).toMatch(/TEST job/);
  });
  test("real job → real partner allowed, TEST partner refused", () => {
    expect(offerPairBlocker(realBiz, "base44")).toBeNull();
    expect(offerPairBlocker(testBiz, "base44")).toMatch(/real job/);
    expect(offerPairBlocker(testBiz, null)).toMatch(/real job/);
  });
  test("unknown trade refused", () => expect(offerPairBlocker(null, "qa_test")).not.toBeNull());
  test("every partner_offers insert is preceded by the guard", () => {
    for (const f of ["readycheck-booking.server.ts", "allocation.server.ts", "pilot.functions.ts", "jo-tradie.server.ts"]) {
      const src = readFileSync(`src/lib/${f}`, "utf8");
      const inserts = src.split('from("partner_offers").insert').length - 1;
      const guards = src.split("assertOfferPairsAllowed").length - 1;
      expect(guards).toBeGreaterThanOrEqual(inserts);
    }
  });
});
