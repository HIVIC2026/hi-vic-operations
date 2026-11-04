// New job flow, Part 9, Task 11: before VEEC creation the installed product must be on the VEU Register on the creation
// day and the owner must have paid $200+ (incl GST) — co-payment rule; a refund after creation is flagged to the office at
// once (Review Focus 4: it can't be stopped in Stripe). Own file: the Stripe refund path mocks its persistence boundary.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { COPAYMENT_TOO_LOW, MIN_COPAYMENT_CENTS, VEEC_COPAYMENT_REFUNDED_EVENT, VEEC_REFUND_CHECK_FAILED_LINE, VEEC_REFUND_NEEDS_LINE, veecCreatedBefore, veecCreationBlockers } from "../src/lib/veec-creation-gate.core";
import { planVeecCreation, type VeecCandidate } from "../src/lib/esc-registry-robot.core";
import { declaredProductProblems } from "../src/lib/install-evidence.core";
import { buildNeedsRows } from "../src/lib/office-needs.core";

const veec = (o: Partial<VeecCandidate> = {}): VeecCandidate => ({
  jobId: "job-1", jobSource: "website", stage: "ready_for_veec", lodgement: { status: "not_submitted", submission_reference: null },
  assignment: { status: "effective_complete", installerSignedAt: "a", apSignedAt: "b", consumerSignedAt: "c" }, quantity: 12, robotEvents: [],
  productProblems: [], installPaidCents: 20000, ...o,
});

describe("veecCreationBlockers: product on the register that day and $200+ paid", () => {
  test("ECOWOOL-only code with the register effectiveTo before the creation day → the product line", () => {
    const problems = declaredProductProblems(null, { installDate: "2029-05-01", veecCreationDate: "2029-05-10" }, ["602009"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^Product: .*not approved on 2029-05-10/);
    expect(veecCreationBlockers({ productProblems: problems, installPaidCents: 20000 })).toEqual(problems);
  });
  test("$199.99 paid → the co-payment line; $200 → clear; unknown (null) → fails closed", () => {
    expect(MIN_COPAYMENT_CENTS).toBe(20000);
    expect(veecCreationBlockers({ productProblems: [], installPaidCents: 19999 })).toEqual([COPAYMENT_TOO_LOW]);
    expect(COPAYMENT_TOO_LOW).toBe("Owner has paid less than $200 (incl GST) — VEECs can't be created yet.");
    expect(veecCreationBlockers({ productProblems: [], installPaidCents: 20000 })).toEqual([]);
    expect(veecCreationBlockers({ productProblems: [], installPaidCents: null })).toEqual([COPAYMENT_TOO_LOW]);
  });
  test("both wrong → product lines first, then the co-payment line", () => {
    expect(veecCreationBlockers({ productProblems: ["Product: x"], installPaidCents: 0 })).toEqual(["Product: x", COPAYMENT_TOO_LOW]);
  });
});

describe("planVeecCreation: any creation blocker = skip for the office", () => {
  test("$200 paid, product fine → submit", () => expect(planVeecCreation(veec()).action).toBe("submit"));
  test("$199.99 → skip, office", () => expect(planVeecCreation(veec({ installPaidCents: 19999 }))).toMatchObject({ action: "skip", office: true, reason: COPAYMENT_TOO_LOW }));
  test("product not on the register that day → skip, office", () => expect(planVeecCreation(veec({ productProblems: ["Product: ECOWOOL 602009 is not approved on 2029-05-10"] }))).toMatchObject({ action: "skip", office: true }));
  test("facts not read (older caller) → skip, office (fails closed)", () => expect(planVeecCreation({ ...veec(), productProblems: undefined, installPaidCents: undefined } as unknown as VeecCandidate)).toMatchObject({ action: "skip", office: true }));
});

describe("refund after VEEC creation", () => {
  test("veecCreatedBefore: a lodgement that is submitted / query / approved counts; not_submitted or rejected does not", () => {
    expect(veecCreatedBefore({ status: "submitted", submission_reference: "VEU-1" })).toBe(true);
    expect(veecCreatedBefore({ status: "approved", submission_reference: "VEU-1" })).toBe(true);
    expect(veecCreatedBefore({ status: "query", submission_reference: null })).toBe(true);
    expect(veecCreatedBefore({ status: "not_submitted", submission_reference: null })).toBe(false);
    expect(veecCreatedBefore({ status: "rejected", submission_reference: null })).toBe(false);
    expect(veecCreatedBefore(null)).toBe(false);
    expect(VEEC_COPAYMENT_REFUNDED_EVENT).toBe("veec_copayment_refunded");
    expect(VEEC_REFUND_NEEDS_LINE).toBe("A payment was refunded after VEECs were created. The $200 minimum can't be refunded — call Jo.");
  });
});

describe("Needs me: the refund-after-creation row", () => {
  test("one Today row with the office line, to the Money card", () => {
    const g = buildNeedsRows({ now: Date.parse("2026-11-21T00:00:00Z"), jobs: [{ jobId: "j1", jobNumber: "HV-1", surname: "Smith", suburb: "Kew", veecRefunded: { at: "2026-11-20T00:00:00Z", text: VEEC_REFUND_NEEDS_LINE } }] });
    const row = g.today.find((r) => r.kind === "veec_refunded")!;
    expect(row.line).toBe(VEEC_REFUND_NEEDS_LINE);
    expect(row.button).toEqual({ label: "Open job", to: "job", section: "money" });
  });
});

// ---------- server: a Stripe refund after lodgement raises ONE office event ----------
const ledger: Record<string, unknown>[] = [];
const logged: { type: string; details: Record<string, unknown> }[] = [];
let lodgement: { status: string; submission_reference: string | null } | null = { status: "submitted", submission_reference: "VEU-9" };
let lodgementReadError: string | null = null; // G6 S9: the VEEC record can't be read
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "contains", "limit", "in", "order"]) q[m] = () => q;
    q["maybeSingle"] = async () => (table === "veec_lodgements" && lodgementReadError ? { data: null, error: { message: lodgementReadError } } : { data: table === "invoices" ? { id: "inv-1", job_id: "job-1", kind: "installation", total_paid: 349, jobs: { source: "qa_test" } } : table === "veec_lodgements" ? lodgement : null, error: null });
    q["then"] = (r: (v: unknown) => unknown) => r({ data: table === "workflow_events" ? [{ job_id: "job-1", details: { invoice_id: "inv-1", amount_cents: 34900 } }] : [], error: null });
    return q;
  },
} }));
mock.module("../src/lib/workflow.server", () => ({ logEvent: async (_j: string, _a: unknown, type: string, _s: string, details: Record<string, unknown>) => { logged.push({ type, details }); } }));
mock.module("../src/lib/payments.server", () => ({
  PAYMENT_EVENT: "owner_payment_recorded", PAYMENT_REVERSED_EVENT: "owner_payment_reversed",
  rawPaymentLedger: async () => ledger,
  // The raw ledger in payments.core PaymentRecord shape, so a second delivery of the same refund is a duplicate.
  insertLedgerEvent: async (jobId: string, _actor: unknown, eventType: string, _summary: string, details: Record<string, unknown>) => {
    ledger.push({ jobId, eventType, kind: eventType === "owner_payment_reversed" ? "reversal" : "payment", source: "card", amountCents: details["amount_cents"], refundedTotalCents: details["refunded_total_cents"] ?? null, stripeIds: [details["stripe_payment_intent"]], paidAt: details["paid_at"] });
    return "recorded";
  },
  flagUnclearPaymentMatches: async () => undefined,
  reconciledInvoicePaidCents: async () => 34_900, // equal to total_paid: no Xero write-back on this path
  afterPaymentsChanged: async () => undefined,
  jobPaymentView: async () => null, stepInvoice: () => null,
}));
const { recordStripeRefund } = await import("../src/lib/stripe.server");
const refund = (eventId = "evt_r1") => ({ eventId, paymentIntentId: "pi_1", chargeId: "ch_1", refundedCents: 20000, refundedAt: "2026-11-20T00:00:00Z", livemode: false });
beforeEach(() => { ledger.length = 0; logged.length = 0; lodgement = { status: "submitted", submission_reference: "VEU-9" }; lodgementReadError = null; });

describe("recordStripeRefund: after lodgement → one veec_copayment_refunded needs_office event", () => {
  test("refund after lodgement → the reversal row AND one office event with the refunded cents and the VEEC reference", async () => {
    expect(await recordStripeRefund(refund())).not.toBe("duplicate");
    expect(ledger.map((r) => r["eventType"])).toEqual(["owner_payment_reversed"]);
    const ev = logged.filter((e) => e.type === VEEC_COPAYMENT_REFUNDED_EVENT);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details).toMatchObject({ refunded_cents: 20000, veec_reference: "VEU-9", needs_office: true });
    expect(ev[0]!.details["line"]).toBe(VEEC_REFUND_NEEDS_LINE);
  });
  test("the same refund delivered twice → still one event (the reversal is a duplicate, nothing more is raised)", async () => {
    await recordStripeRefund(refund());
    expect(await recordStripeRefund(refund("evt_r1_again"))).toBe("duplicate");
    expect(logged.filter((e) => e.type === VEEC_COPAYMENT_REFUNDED_EVENT)).toHaveLength(1);
  });
  test("refund before any lodgement → no office event (the existing payment-reversed row covers it)", async () => {
    lodgement = { status: "not_submitted", submission_reference: null };
    await recordStripeRefund(refund());
    expect(ledger).toHaveLength(1);
    expect(logged.filter((e) => e.type === VEEC_COPAYMENT_REFUNDED_EVENT)).toHaveLength(0);
  });
  // G6 S9 (final Part 9 review): the VEEC record can't be read → the office is still told (needs_office, the check-failed
  // line) instead of a console line nobody sees; the refund itself is still recorded.
  test("S9: the lodgement read fails → one needs_office event with the check-failed line (never silent); the reversal row still lands", async () => {
    lodgementReadError = "relation veec_lodgements is locked";
    expect(await recordStripeRefund(refund())).not.toBe("duplicate");
    expect(ledger.map((r) => r["eventType"])).toEqual(["owner_payment_reversed"]);
    const ev = logged.filter((e) => e.type === VEEC_COPAYMENT_REFUNDED_EVENT);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details).toMatchObject({ needs_office: true, check_failed: true, refunded_cents: 20000, line: VEEC_REFUND_CHECK_FAILED_LINE("relation veec_lodgements is locked") });
  });
});

// G6 S9: a Xero reversal (owner_payment_reversed from a deleted / voided Xero payment) raises the same office flag.
describe("flagRefundAfterVeecCreation (shared): Xero reversals are covered too", () => {
  test("a Xero reversal after lodgement → one event carrying the Xero payment id; before lodgement → nothing; the Xero writer calls it", async () => {
    const { flagRefundAfterVeecCreation } = await import("../src/lib/veec-refund-flag.server");
    await flagRefundAfterVeecCreation("job-1", { refundedCents: 34900, source: "xero", xeroPaymentId: "xp-1" });
    const ev = logged.filter((e) => e.type === VEEC_COPAYMENT_REFUNDED_EVENT);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details).toMatchObject({ refunded_cents: 34900, veec_reference: "VEU-9", source: "xero", xero_payment_id: "xp-1", needs_office: true, line: VEEC_REFUND_NEEDS_LINE });
    lodgement = { status: "not_submitted", submission_reference: null };
    await flagRefundAfterVeecCreation("job-1", { refundedCents: 100, source: "xero", xeroPaymentId: "xp-2" });
    expect(logged.filter((e) => e.type === VEEC_COPAYMENT_REFUNDED_EVENT)).toHaveLength(1);
    const payments = await Bun.file(new URL("../src/lib/payments.server.ts", import.meta.url)).text();
    expect(payments).toMatch(/PAYMENT_REVERSED_EVENT[\s\S]*flagRefundAfterVeecCreation\(jobId, \{ refundedCents: p\.amountCents, source: "xero", xeroPaymentId: p\.xeroPaymentId \}\)/);
    const stripe = await Bun.file(new URL("../src/lib/stripe.server.ts", import.meta.url)).text();
    expect(stripe).toContain('import("./veec-refund-flag.server")');
    // The Needs me reader shows the event's own line (the check-failed line when the record couldn't be read).
    const needs = await Bun.file(new URL("../src/lib/office-needs.server.ts", import.meta.url)).text();
    expect(needs).toMatch(/veecRefunded = \{ at: String\(r\["created_at"\]\), text: [^}]*line[^}]*\}/);
  });
});
