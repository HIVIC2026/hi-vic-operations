import { describe, expect, test } from "bun:test";
import { GATE_DOCS, PAYMENT_TERMS_BODY, PAYMENT_TERMS_VERSION } from "../src/lib/owner-gates.core";

// New job flow (Jo 2 Nov 2026): the payment statement is the payment terms page of Customer Agreement v1.3.
// Electrical upgrades are paid to the electrician directly, so there is no "own invoice" line any more.
describe("payment statement = agreement v1.3 payment terms", () => {
  test("new version, wired into the Gate B item", () => {
    expect(PAYMENT_TERMS_VERSION).toBe("customer-agreement-1.4");
    expect(GATE_DOCS.find((d) => d.key === "payment_terms")!.version).toBe(PAYMENT_TERMS_VERSION);
  });
  test("steps 1 to 3 and the price line use the server's amounts", () => {
    for (const line of [
      "Electrical safety check (PIESA): {fee}",
      "50% deposit to book your install day: {deposit}",
      "The rest: {balance}",
      "Your price (incl. GST): {total}",
    ])
      expect(PAYMENT_TERMS_BODY).toContain(line);
  });
  test("electrical upgrades are paid to the electrician, not on our invoice", () => {
    expect(PAYMENT_TERMS_BODY).toContain("you pay your electrician directly");
    expect(PAYMENT_TERMS_BODY).not.toContain("own invoice");
  });
});
