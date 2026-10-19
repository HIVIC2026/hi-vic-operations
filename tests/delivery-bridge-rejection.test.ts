import { describe, expect, test } from "bun:test";
import {
  bridgeAdapter,
  bridgeBody,
  bridgeRejectionReason,
  statusAfterDeliveryError,
} from "../src/lib/delivery.core";

const secret = "synthetic-test-credential-0000000000000000";
const message = {
  to: "test@example.com",
  subject: "Test subject",
  html: "<p>Test body</p>",
  text: "Test body",
  idempotencyKey: "test:bridge:1",
  purpose: "test",
};

describe("Base44 rejection diagnostics", () => {
  test("400 records the receiver reason without changing payload or idempotency", async () => {
    let calls = 0;
    const fake = (async (_url: unknown, init: RequestInit) => {
      calls++;
      expect(init.body).toBe(bridgeBody(message));
      expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("test:bridge:1");
      return new Response(JSON.stringify({ error: "Invalid recipient" }), { status: 400 });
    }) as typeof fetch;
    const error = await bridgeAdapter({ url: "https://bridge.example/test", secret }, fake)
      .deliver(message)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) throw new Error("Expected rejection");
    expect(error.message).toBe("Base44 delivery bridge returned 400: Invalid recipient");
    expect(statusAfterDeliveryError(error)).toBe("failed");
    expect(calls).toBe(1);
  });
  test("JSON reasons discard credential fields and redact echoes", () => {
    const reason = bridgeRejectionReason(
      JSON.stringify({
        error: {
          message: `Invalid recipient test@example.com ${secret}`,
          code: "INVALID_RECIPIENT",
          token: "must-not-appear",
        },
        html: "must-not-appear",
      }),
      [secret],
    );
    expect(reason).toContain("Invalid recipient");
    expect(reason).toContain("INVALID_RECIPIENT");
    expect(reason).not.toContain(secret);
    expect(reason).not.toContain("test@example.com");
    expect(reason).not.toContain("must-not-appear");
  });
  test("plain text redacts credentials, links and bounds stored reason", () => {
    const reason = bridgeRejectionReason(
      `Invalid input token=private-value Bearer private-auth https://example.com/?token=secret ${"x".repeat(500)}`,
      [],
    );
    expect(reason).toContain("Invalid input");
    expect(reason).not.toContain("private-value");
    expect(reason).not.toContain("private-auth");
    expect(reason).not.toContain("https://");
    expect(reason.length).toBeLessThanOrEqual(220);
  });
  test("network uncertainty still blocks automatic retry", async () => {
    const fake = (async () => {
      throw new Error("timeout");
    }) as typeof fetch;
    const error = await bridgeAdapter({ url: "https://bridge.example/test", secret }, fake)
      .deliver(message)
      .catch((e: unknown) => e);
    expect(statusAfterDeliveryError(error)).toBe("delivered_unrecorded");
  });
});
