import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ASSESSMENT_ACCEPTANCE_COPY_VERSION, ASSESSMENT_PAYMENT_AMOUNT, acceptanceIsCurrent, assessmentRemaining, readyForAssessmentNextAction, testPaymentTransition } from "../src/lib/assessment-payment.core";

describe("pre-assessment acceptance and test payment", () => {
  test("amount and snapshot calculations are fixed and deterministic", () => {
    expect(ASSESSMENT_PAYMENT_AMOUNT).toBe(349);
    expect(ASSESSMENT_ACCEPTANCE_COPY_VERSION).toBe("pre-assessment-v1");
    expect(assessmentRemaining(3716.24)).toBe(3367.24);
    expect(assessmentRemaining(200)).toBe(0);
  });

  test("payment lifecycle supports failure, retry and idempotent success", () => {
    expect(testPaymentTransition("unpaid", "failure")).toBe("failed");
    expect(testPaymentTransition("failed", "success")).toBe("paid");
    expect(testPaymentTransition("paid", "failure")).toBe("paid");
    expect(testPaymentTransition("paid", "success")).toBe("paid");
  });

  test("a changed official estimate is stale before payment", () => {
    expect(acceptanceIsCurrent("estimate-1", "estimate-1")).toBe(true);
    expect(acceptanceIsCurrent("estimate-1", "estimate-2")).toBe(false);
    expect(acceptanceIsCurrent("estimate-1", null)).toBe(false);
  });

  test("successful payment points only to Measure + PIESA assignment or scheduling", () => {
    expect(readyForAssessmentNextAction("awaiting_electrician")).toBe("Assign electrician for Measure + PIESA");
    expect(readyForAssessmentNextAction("assessment_booking")).toBe("Arrange Measure + PIESA assessment");
  });

  test("schema is immutable, idempotent and service-only", () => {
    const sql = readFileSync("drizzle/migrations/0040_pre_assessment_acceptance_test_payments.sql", "utf8");
    const atomic = readFileSync("drizzle/migrations/0041_atomic_pre_assessment_test_lifecycle.sql", "utf8");
    const corrected = readFileSync("drizzle/migrations/0042_correct_pre_assessment_attempt_row_count.sql", "utf8");
    for (const table of ["assessment_acceptances", "assessment_payments", "assessment_payment_attempts"]) {
      expect(sql).toContain(`CREATE TABLE public.${table}`);
      expect(sql).toContain(`GRANT ALL ON public.${table} TO service_role`);
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain("UNIQUE (job_id, estimate_id)");
    expect(sql).toContain("UNIQUE (payment_id, idempotency_key)");
    expect(sql).toContain("WHERE status = 'paid'");
    expect(sql.match(/amount_inc_gst = 349\.00/g)?.length).toBe(2);
    expect(atomic).toContain("ON CONFLICT (job_id, estimate_id) DO NOTHING");
    expect(atomic).toContain("ON CONFLICT (payment_id, idempotency_key) DO NOTHING");
    expect(atomic).toContain("FOR UPDATE");
    expect(atomic).toContain("REVOKE ALL ON FUNCTION public.accept_pre_assessment_test");
    expect(atomic).toContain("REVOKE ALL ON FUNCTION public.apply_pre_assessment_test_payment");
    expect(corrected).toContain("inserted_attempt_count integer");
  });

  test("server remains separate from final quote, invoice, deposit and Xero machinery", () => {
    const server = readFileSync("src/lib/assessment-payment.server.ts", "utf8");
    for (const forbidden of ["from(\"quotes\")", "from(\"invoices\")", "depositCleared", "pushInvoiceToXero", "xero.server", "respondToQuote", "customer_agreements"]) expect(server).not.toContain(forbidden);
    expect(server).toContain("assessment_acceptances");
    expect(server).toContain("assessment_payments");
    expect(server).toContain('admin.rpc("apply_pre_assessment_test_payment"');
    expect(server).toContain("estimate.status !== \"current\"");
  });

  test("audit keys and callbacks are deterministic", () => {
    const server = readFileSync("src/lib/assessment-payment.server.ts", "utf8");
    const atomic = readFileSync("drizzle/migrations/0041_atomic_pre_assessment_test_lifecycle.sql", "utf8");
    expect(atomic).toContain("pre_assessment_accepted:' || a.id::text");
    expect(atomic).toContain("pre_assessment_payment:' || p.id::text || ':' || _idempotency_key");
    expect(server).toContain("pre_assessment_ready:${paymentId}");
    expect(server).toContain("if (state.paymentStatus === \"paid\") return state");
  });

  test("calculator remains local and cannot mutate the accepted snapshot", () => {
    const ui = readFileSync("src/components/portal/estimate.tsx", "utf8");
    const calc = ui.slice(ui.indexOf("export function AreaCalculator"), ui.indexOf("export function OwnerEstimateCard"));
    expect(calc).not.toContain("acceptPreAssessment");
    expect(calc).not.toContain("simulatePreAssessmentPayment");
    expect(calc).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/);
  });

  test("existing final installation deposit and Xero rules remain present", () => {
    const workflow = readFileSync("src/lib/workflow.server.ts", "utf8");
    const xero = readFileSync("src/lib/xero.server.ts", "utf8");
    expect(workflow).toContain("50% deposit not paid – scheduling locked until Xero confirms payment.");
    expect(workflow).toContain('.eq("kind", "installation")');
    expect(xero).toContain("pushInvoiceToXero");
    expect(workflow).toContain("$349 Measure + PIESA pre-assessment payment not received.");
  });
});