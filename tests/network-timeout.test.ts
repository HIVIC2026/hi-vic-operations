import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { timeoutSignal, MITTI_FETCH_TIMEOUT_MS, RESEND_FETCH_TIMEOUT_MS, TWILIO_FETCH_TIMEOUT_MS, XERO_FETCH_TIMEOUT_MS } from "../src/lib/network-timeout.core";

const read = (file: string) => readFileSync(file, "utf8");

describe("external integration network safety", () => {
  test("configured integration timeouts are bounded", () => {
    expect(MITTI_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
    expect(RESEND_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
    expect(TWILIO_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(15_000);
    expect(XERO_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
    const signal = timeoutSignal(10);
    expect(signal === null || signal instanceof AbortSignal).toBe(true);
  });

  test("Mitti create calls have timeout and duplicate-start guard", () => {
    const source = read("src/lib/mitti.server.ts");
    expect(source).toContain("timeoutSignal(MITTI_FETCH_TIMEOUT_MS)");
    expect(source).toContain("claimMittiCreate(");
    // T3: the guard is now an atomic claim (behaviour proven in tests/t3-mitti-async-claim.test.ts).
    const claim = read("src/lib/mitti-create-claim.core.ts");
    expect(claim).toContain('"mitti_audit_create_started"');
    expect(claim).toContain("Do not retry yet");
  });

  test("Twilio, Resend and Xero network boundaries have timeout signals", () => {
    expect(read("src/lib/twilio-au1.server.ts")).toContain("timeoutSignal(TWILIO_FETCH_TIMEOUT_MS)");
    expect(read("src/lib/office-email.server.ts")).toContain("timeoutSignal(RESEND_FETCH_TIMEOUT_MS)");
    expect(read("src/lib/test-send.server.ts")).toContain("timeoutSignal(RESEND_FETCH_TIMEOUT_MS)");
    expect(read("src/lib/hot-leads-send.server.ts")).toContain("timeoutSignal(RESEND_FETCH_TIMEOUT_MS)");
    expect(read("src/lib/xero.server.ts")).toContain("timeoutSignal(XERO_FETCH_TIMEOUT_MS)");
  });

  test("Xero live calls remain disabled in code", () => {
    expect(read("src/lib/xero.core.ts")).toContain("export const XERO_LIVE_CALLS_ENABLED = false");
  });
});
