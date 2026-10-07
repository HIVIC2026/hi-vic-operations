import { describe, expect, test } from "bun:test";
import { evaluatePaymentGate, paymentGateEnabledFor, PAYMENT_RULE_PENDING } from "../src/lib/payment-gate.core";

const quote = { id: "q1" } as never;
const paidInvoice = { id: "i1", quote_id: "q1", total_inc_gst: 5000, total_paid: 349 } as never;
const base = { route: "hiv_lead" as const, currentQuote: quote, invoice: paidInvoice, plan: null, overrideCount: 0, qaSimulated: null, safetyFeeIncGst: 349 };

describe("payment rule ON for TEST jobs only (Jo 7 Oct)", () => {
  test("TEST job passes the gate while the global switch is OFF", () => {
    const enabled = paymentGateEnabledFor({ globalEnabled: false, jobSource: "qa_test", qaArchived: false });
    expect(enabled).toBe(true);
    expect(evaluatePaymentGate({ ...base, enabled } as never).cleared).toBe(true);
  });
  test("real jobs stay locked while the global switch is OFF", () => {
    for (const src of ["base44", "installer_import", "manual", null, undefined]) {
      const enabled = paymentGateEnabledFor({ globalEnabled: false, jobSource: src, qaArchived: false });
      expect(enabled).toBe(false);
      const r = evaluatePaymentGate({ ...base, enabled } as never);
      expect(r.cleared).toBe(false);
      expect(r.blocker).toBe(PAYMENT_RULE_PENDING);
    }
  });
  test("archived TEST job stays locked", () => {
    expect(paymentGateEnabledFor({ globalEnabled: false, jobSource: "qa_test", qaArchived: true })).toBe(false);
  });
  test("TEST job still needs the safety check payment", () => {
    const enabled = paymentGateEnabledFor({ globalEnabled: false, jobSource: "qa_test", qaArchived: false });
    const r = evaluatePaymentGate({ ...base, enabled, invoice: { ...(paidInvoice as object), total_paid: 0 } } as never);
    expect(r.cleared).toBe(false);
  });
});
