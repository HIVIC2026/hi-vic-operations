// Decision 368 (audit F18): the office cannot type a payment in. payments.functions.ts exports reads + the Xero link
// refresh only; recordOwnerPayment / recordManualPayment and the panel's "Record payment" form are gone. The QA-only
// simulateXeroPayment (qa_test jobs) stays.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("no manual office payment entry (decision 368)", () => {
  test("payments.functions.ts exports no payment-writing server function", () => {
    const src = read("src/lib/payments.functions.ts");
    const exported = [...src.matchAll(/export const (\w+)\s*=\s*createServerFn/g)].map((m) => m[1]);
    // markPaymentsSeparateFn (Jo 28 Oct) only marks a card + Xero pair as two separate payments; it records no money.
    expect(exported.sort()).toEqual(["getJobPayments", "markPaymentsSeparateFn", "refreshPayNowLink"]);
    expect(src).not.toMatch(/recordOwnerPayment|recordManualPayment|owner_payment_recorded|logEvent/);
  });
  test("the server has no manual-record path and the office panel has no Record payment form", () => {
    expect(read("src/lib/payments.server.ts")).not.toMatch(/export async function recordManualPayment/);
    const panels = read("src/components/portal/panels.tsx");
    expect(panels).not.toMatch(/recordOwnerPayment|>\s*Record payment|"Record payment"|Payment recorded/);
  });
  test("simulateXeroPayment stays, for TEST jobs only", () => {
    const pf = read("src/lib/portal.functions.ts");
    const i = pf.indexOf("export const simulateXeroPayment");
    expect(i).toBeGreaterThan(-1);
    expect(pf.slice(i, i + 1200)).toMatch(/qa_test/);
  });
});
