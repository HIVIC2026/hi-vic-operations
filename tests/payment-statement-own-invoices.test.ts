import { describe, expect, test } from "bun:test";
import { GATE_DOCS, PAYMENT_TERMS_BODY, PAYMENT_TERMS_VERSION } from "../src/lib/owner-gates.core";

// Jo 29 Oct 2026 ("Ok"): after batch 3b the fixes have their own invoice, so the payment statement no longer says
// "one invoice". Only the opening line and step 2 change; new wording = new version (stays unapproved until Jo approves).
describe("Jo 29 Oct: payment statement matches separate invoices", () => {
  test("new version, not the earlier unapproved 29 Oct one", () => {
    expect(PAYMENT_TERMS_VERSION).toBe("steps-2026-10-29b");
    expect(GATE_DOCS.find((d) => d.key === "payment_terms")!.version).toBe(PAYMENT_TERMS_VERSION);
  });
  test("opening line names the install invoice, not one invoice", () => {
    expect(PAYMENT_TERMS_BODY).not.toContain("one invoice");
    expect(
      PAYMENT_TERMS_BODY.startsWith(
        "How I'll pay for this job. My install invoice is {total} inc GST, and there is no card fee.",
      ),
    ).toBe(true);
  });
  test("step 2: fixes paid on their own invoice", () => {
    expect(PAYMENT_TERMS_BODY).toContain(
      "2. Electrical fixes, only if the electrician finds they're needed: I'll see the price first, and if I approve them I pay for the fixes in full then, on their own invoice, by card or bank transfer.",
    );
  });
  test("steps 1, 3, 4 and the last line are unchanged", () => {
    for (const line of [
      "1. Safety check: {fee} for the Pre Insulation Electrical Safety Assessment (PIESA), now that I accept, by card or bank transfer. I understand it's non-refundable once the PIESA is done, even if it finds the job can't go ahead.",
      "3. Install deposit: {deposit} (10% of the remaining {remaining}) to book my install day, by card, bank transfer or PayID.",
      "4. Balance: {balance} on install day, by bank transfer or PayID.",
      "I can pay whatever is left at any time by bank transfer or PayID.",
    ])
      expect(PAYMENT_TERMS_BODY).toContain(line);
  });
});
