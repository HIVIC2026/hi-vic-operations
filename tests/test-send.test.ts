import { describe, expect, test } from "bun:test";
import { normaliseAuMobile, testSendBlocker } from "../src/lib/test-send.core";

const jo = { partnerIsTest: true, jobSource: "qa_test" };

describe("test sending allowlist", () => {
  test("Jo's mobile and email are allowed on TEST jobs", () => {
    for (const to of ["0477 511 901", "+61477511901", "61477511901"]) expect(testSendBlocker({ channel: "sms", to, ...jo })).toBeNull();
    expect(testSendBlocker({ channel: "email", to: " Sweet_Sunshine231@hotmail.com ", ...jo })).toBeNull();
    expect(testSendBlocker({ channel: "email", to: "sweet_sunshine231@hotmail.com", partnerIsTest: true, jobSource: null })).toBeNull();
  });
  test("a real owner or trade can never receive anything", () => {
    const real = ["0412 345 678", "+61400000001", "0477511900"];
    for (const to of real) for (const jobSource of ["qa_test", "base44", "bulk_import", null]) for (const partnerIsTest of [true, false])
      expect(testSendBlocker({ channel: "sms", to, jobSource, partnerIsTest })).not.toBeNull();
    for (const to of ["owner@gmail.com", "trade@electrical.com.au", "sweet_sunshine231@hotmail.com.evil.com", "x+sweet_sunshine231@hotmail.com", ""])
      expect(testSendBlocker({ channel: "email", to, ...jo })).not.toBeNull();
  });
  test("even Jo is blocked on real jobs or real partners", () => {
    expect(testSendBlocker({ channel: "sms", to: "0477511901", jobSource: "base44", partnerIsTest: true })).not.toBeNull();
    expect(testSendBlocker({ channel: "sms", to: "0477511901", jobSource: "qa_test", partnerIsTest: false })).not.toBeNull();
  });
  test("mobile normalising", () => {
    expect(normaliseAuMobile("0477 511 901")).toBe("+61477511901");
    expect(normaliseAuMobile("0398765432")).toBeNull();
  });
});
