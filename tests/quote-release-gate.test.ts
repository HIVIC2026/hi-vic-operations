import { describe, expect, test } from "bun:test";
import { portalReleaseEnabled } from "../src/lib/quote-release-gate.core";

describe("owner quote release gate (portal only)", () => {
  test("real customers stay locked while either launch switch is off", () => {
    expect(portalReleaseEnabled({ autoSendQuote: false, customerCommsEnabled: false, jobSource: "web" })).toBe(false);
    expect(portalReleaseEnabled({ autoSendQuote: true, customerCommsEnabled: false, jobSource: "web" })).toBe(false);
    expect(portalReleaseEnabled({ autoSendQuote: false, customerCommsEnabled: true, jobSource: "web" })).toBe(false);
    expect(portalReleaseEnabled({ autoSendQuote: null, customerCommsEnabled: null, jobSource: null })).toBe(false);
  });
  test("real customers release only when both switches are on", () => {
    expect(portalReleaseEnabled({ autoSendQuote: true, customerCommsEnabled: true, jobSource: "web" })).toBe(true);
  });
  test("synthetic qa_test journeys may release to the portal while comms stay off", () => {
    expect(portalReleaseEnabled({ autoSendQuote: false, customerCommsEnabled: false, jobSource: "qa_test" })).toBe(true);
  });
  test("only the exact qa_test source is exempt", () => {
    for (const source of ["QA_TEST", "qa_test ", "web", "partner", "test", null, undefined])
      expect(portalReleaseEnabled({ autoSendQuote: false, customerCommsEnabled: false, jobSource: source })).toBe(false);
  });
});
