// Batch 3b Task 4: each payment step is paid on its OWN invoice — the installation invoice ($349 safety check, 10% install
// deposit, balance), the fixes invoice ("… fixes") and the repeat safety check invoice ("… safety check 2"). The pure
// plan maths, then the REAL payments.server / stripe.server / owner-myjob.server against an in-memory database. Stripe
// HTTP is mocked (global fetch); never reaches the network.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { paymentPlan, paymentSteps, payableNow, type PaymentStepKey } from "../src/lib/payments.core";

const J = "00000000-0000-4000-8000-0000000000j2";
const QI = "00000000-0000-4000-8000-0000000000q1", QF = "00000000-0000-4000-8000-0000000000q2", QF0 = "00000000-0000-4000-8000-0000000000q0";
const INV = "00000000-0000-4000-8000-0000000000i1", INVF = "00000000-0000-4000-8000-0000000000i2", INVR = "00000000-0000-4000-8000-0000000000i3", INVF0 = "00000000-0000-4000-8000-0000000000i0";
const KEY = "reopen:2026-10-25T01:00:00.000Z";
const TOKEN = "t".repeat(48);
const NOW = "2026-10-29T00:00:00.000Z";
const tables: Tables = {};
let clock = Date.parse("2026-10-28T00:00:00Z");
const nextAt = () => new Date((clock += 1000)).toISOString();

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: null, error: null }) } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  WorkflowError: class extends Error {}, paymentGateActiveForJob: async () => true,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: nextAt() }); },
}));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => null }));
const fixesBooked: string[] = [], offers: string[] = [];
mock.module("../src/lib/owner-fixes.server", () => ({ ownerFixesState: async () => ({ step: 'none' }), bookPickedFixesTime: async (id: string) => { fixesBooked.push(id); return false; } }));
mock.module("../src/lib/allocation.server", () => ({ startPiesaAllocation: async (id: string) => { offers.push(id); return { offered: 1, exhausted: false }; } }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => undefined }));
mock.module("../src/lib/owner-email-triggers.server", () => ({ onSafetyCheckPaid: async () => undefined }));
mock.module("../src/lib/installer-accepted-email.server", () => ({ emailInstallerOnSafetyCheckPaid: async () => undefined }));
mock.module("../src/lib/xero.server", () => ({
  applyPaidAmount: async (id: string, dollars: number) => { const r = tables["invoices"]!.find((i) => i["id"] === id); if (r) r["total_paid"] = dollars; },
  createRepeatInvoice: async () => ({ invoiceId: INVR }),
}));

const pay = await import("../src/lib/payments.server");
const stripe = await import("../src/lib/stripe.server");
const { resolveOwnerJob } = await import("../src/lib/owner-myjob.server");

// ---------- mocked Stripe HTTP ----------
const sessions: Record<string, string>[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = String(input);
  if (url === "https://api.stripe.com/v1/checkout/sessions") {
    sessions.push(Object.fromEntries(new URLSearchParams(String(init?.body))));
    return new Response(JSON.stringify({ id: `cs_${sessions.length}`, url: `https://checkout.stripe.test/${sessions.length}` }), { status: 200 });
  }
  if (url.startsWith("https://api.stripe.com/v1/payment_intents/")) return new Response(JSON.stringify({ latest_charge: null }), { status: 200 });
  throw new Error(`network blocked: ${url}`);
}) as unknown as typeof fetch;
process.env["STRIPE_PAYMENTS_ENABLED"] = "true"; process.env["STRIPE_SECRET_KEY"] = "sk_live_test_only_key";
afterAll(() => { globalThis.fetch = realFetch; });

const invoice = (id: string, kind: string, total: number, extra: Record<string, unknown> = {}) => ({
  id, job_id: J, kind, quote_id: null, repeat_key: null, status: "deposit_due", total_inc_gst: total, total_paid: 0, deposit_amount: total, balance_amount: 0,
  xero_invoice_id: `x-${id.slice(-2)}`, xero_invoice_number: null, xero_reference: null, xero_online_url: null, balance_due_date: null, created_at: "2026-10-20T01:00:00.000Z", ...extra,
});
let pn = 0;
/** One Xero payment on the ledger of that invoice. */
const payXero = (invoiceId: string, dollars: number) => tables["workflow_events"]!.push({ id: `pay-${++pn}`, job_id: J, actor_id: null, event_type: "owner_payment_recorded", summary: "paid", created_at: nextAt(),
  details: { invoice_id: invoiceId, amount_cents: Math.round(dollars * 100), source: "xero", paid_at: nextAt(), xero_payment_id: `xp-${pn}`, receipt_key: `xero:${invoiceId}:xp-${pn}` } });
const setStage = (stage: string) => { tables["jobs"]![0]!["stage"] = stage; };
const ev = (type: string, at: string, details: unknown) => tables["workflow_events"]!.push({ id: `seed-${++pn}`, job_id: J, actor_id: null, event_type: type, summary: type, details, created_at: at });

function seed(opts: { fixes?: boolean; fixesInvoice?: boolean; installInvoice?: boolean; fixesFirst?: boolean } = {}) {
  const { fixes = true, fixesInvoice = true, installInvoice = true, fixesFirst = false } = opts;
  for (const k of Object.keys(tables)) delete tables[k];
  fixesBooked.length = 0; offers.length = 0; sessions.length = 0;
  Object.assign(tables, {
    owners: [{ id: "o1", full_name: "Pat Smith", email: "pat@example.com" }],
    properties: [{ id: "p1", address_line: "1 Test St", suburb: "Testville", state: "VIC", postcode: "3000" }],
    jobs: [{ id: J, job_number: "HV-0202", business_unit: "hivic", source: "website", stage: "rectification_scheduling", owner_id: "o1", property_id: "p1", channel: "web", external_refs: {}, deleted_at: null }],
    quotes: [
      { id: QI, job_id: J, kind: "installation", status: "accepted", release_state: "released", option_label: "R5.0", customer_total_inc_gst: 4000, veec_discount_inc_gst: 749, subtotal_inc_gst: 4749, version: 1,
        sent_at: "2026-10-19T00:00:00.000Z", accepted_at: fixesFirst ? "2026-10-22T01:00:00.000Z" : "2026-10-20T01:00:00.000Z", created_at: "2026-10-19T00:00:00.000Z" },
      ...(fixes ? [{ id: QF, job_id: J, kind: "rectification", status: "accepted", version: 1, customer_total_inc_gst: 550, accepted_at: fixesFirst ? "2026-10-21T01:00:00.000Z" : "2026-10-23T01:00:00.000Z", created_at: fixesFirst ? "2026-10-21T00:00:00.000Z" : "2026-10-23T00:00:00.000Z" }] : []),
    ],
    quote_items: [{ id: "qi-1", quote_id: QI, code: "PIESA", description: "PIESA", quantity: 1, line_total_inc_gst: 349, sort: 1 }],
    invoices: [
      ...(installInvoice ? [invoice(INV, "installation", 4000, { quote_id: QI, deposit_amount: 349, balance_amount: 3651, xero_invoice_number: "INV-0101", xero_reference: "Home Insulation Victoria HV-0202" })] : []),
      ...(fixes && fixesInvoice ? [invoice(INVF, "rectification", 550, { quote_id: QF, xero_invoice_number: "INV-FIX", xero_reference: "Home Insulation Victoria HV-0202 fixes", created_at: "2026-10-23T02:00:00.000Z" })] : []),
    ],
    workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349, office_time_limits: {}, piesa_install_window_days: 30 }],
    piesa_records: [{ id: "pr-1", job_id: J, kind: "initial", outcome: "fail", section_c_signed_at: null, is_current: true, created_at: "2026-10-21T00:00:00.000Z" }],
    bookings: [], payment_overrides: [], workflow_events: [],
    customer_estimate_links: [{ id: "l1", job_id: J, token: TOKEN, purpose: "step3_estimate", status: "active", expires_at: "2099-01-01T00:00:00.000Z" }],
    indicative_estimates: [], ready_check_acceptances: [], lead_campaign_responses: [], owner_esc_consents: [], customer_assignments: [], job_assignments: [],
  });
}
const S = 34_900, D = 36_510; // safety check; 10% of (4000 − 349)
const step = (v: { steps: { key: PaymentStepKey }[] } | null, k: PaymentStepKey) => v!.steps.find((s) => s.key === k) as Awaited<ReturnType<typeof pay.jobPaymentView>> extends infer V ? V extends { steps: (infer T)[] } ? T : never : never;
const addRepeat = (paidDollars = 0) => {
  ev("piesa_superseded_on_reopen", "2026-10-25T01:00:00.000Z", { key: KEY, had_check: true });
  ev("repeat_piesa_payer_chosen", "2026-10-25T01:01:00.000Z", { deadline: KEY, payer: "owner", price_inc_gst: 220, suggestion: null });
  ev("repeat_piesa_accepted", "2026-10-25T01:02:00.000Z", { deadline: KEY, payer: "owner", owner_charge_inc_gst: 220 });
  tables["invoices"]!.push(invoice(INVR, "repeat_safety_check", 220, { repeat_key: KEY, xero_invoice_number: "INV-REP", xero_reference: "Home Insulation Victoria HV-0202 safety check 2", created_at: "2026-10-25T01:03:00.000Z" }));
  if (paidDollars) payXero(INVR, paidDollars);
};

describe("pure plan: every step counts only its own invoice's money", () => {
  const plain = paymentPlan({ quoteTotalCents: 400_000, safetyCheckCents: S });
  const full = paymentPlan({ quoteTotalCents: 400_000, safetyCheckCents: S, fixesCents: 55_000, repeatCents: 22_000 });
  const facts = { safety_check: { requestedAt: NOW }, fixes: { requestedAt: NOW }, install_deposit: { requestedAt: NOW }, repeat_safety_check: { requestedAt: NOW } };
  test("safety check / deposit / balance thresholds come from install money only — same numbers as without fixes", () => {
    expect(full.thresholds.safety_check).toBe(plain.thresholds.safety_check);
    expect(full.thresholds.install_deposit).toBe(plain.thresholds.install_deposit);
    expect(full.thresholds.balance).toBe(plain.thresholds.balance);
    expect(full.thresholds.install_deposit).toBe(S + D);
    expect(full.thresholds.balance).toBe(400_000);
    expect(full.installDepositCents).toBe(D);
    expect(full.grandTotalCents).toBe(400_000 + 55_000 + 22_000);
    const s = paymentSteps(full, { install: S + D, fixes: 0, repeat: 0 }, facts, NOW);
    expect(s.find((x) => x.key === "safety_check")!.state).toBe("paid");
    expect(s.find((x) => x.key === "install_deposit")!.state).toBe("paid");
    expect(s.find((x) => x.key === "fixes")!.state).toBe("requested");
    expect(s.find((x) => x.key === "repeat_safety_check")!.state).toBe("requested");
  });
  test("fixes step paid ⇔ the fixes invoice is paid in full (install money never counts)", () => {
    const s1 = paymentSteps(full, { install: 400_000, fixes: 54_999, repeat: 0 }, facts, NOW).find((x) => x.key === "fixes")!;
    expect(s1.state).toBe("requested");
    expect(s1.outstandingCents).toBe(1);
    expect(paymentSteps(full, { install: 0, fixes: 55_000, repeat: 0 }, facts, NOW).find((x) => x.key === "fixes")!.state).toBe("paid");
    // and fixes money never moves the install steps
    const s2 = paymentSteps(full, { install: 0, fixes: 999_999, repeat: 0 }, facts, NOW);
    expect(s2.find((x) => x.key === "safety_check")!.state).toBe("requested");
    expect(s2.find((x) => x.key === "install_deposit")!.outstandingCents).toBe(D);
  });
  test("repeat step paid ⇔ the repeat invoice is paid in full", () => {
    expect(paymentSteps(full, { install: 400_000, fixes: 55_000, repeat: 21_999 }, facts, NOW).find((x) => x.key === "repeat_safety_check")!.state).toBe("requested");
    expect(paymentSteps(full, { install: 0, fixes: 0, repeat: 22_000 }, facts, NOW).find((x) => x.key === "repeat_safety_check")!.state).toBe("paid");
  });
  test("remaining = what is left on each invoice (an overpaid invoice never pays another)", () => {
    const paid = { install: 450_000, fixes: 0, repeat: 0 };
    expect(payableNow(full, paymentSteps(full, paid, facts, NOW), paid).remainingCents).toBe(55_000 + 22_000);
  });
});

describe("jobPaymentView: one invoice per step", () => {
  beforeEach(() => seed());
  test("install + newest fixes + current repeat invoice; each step's invoice and money", async () => {
    addRepeat();
    payXero(INV, 349);
    const v = await pay.jobPaymentView(J, new Date(NOW));
    expect(v!.invoices.install!.id).toBe(INV);
    expect(v!.invoices.fixes!.id).toBe(INVF);
    expect(v!.invoices.repeat!.id).toBe(INVR);
    expect(pay.stepInvoice(v!, "safety_check")!.id).toBe(INV);
    expect(pay.stepInvoice(v!, "install_deposit")!.id).toBe(INV);
    expect(pay.stepInvoice(v!, "balance")!.id).toBe(INV);
    expect(pay.stepInvoice(v!, "fixes")!.id).toBe(INVF);
    expect(pay.stepInvoice(v!, "repeat_safety_check")!.id).toBe(INVR);
    expect(v!.paid).toEqual({ install: S, fixes: 0, repeat: 0 });
    expect(v!.plan.quoteTotalCents).toBe(400_000);
    expect(v!.plan.fixesCents).toBe(55_000);
    expect(v!.plan.repeatCents).toBe(22_000);
    expect(v!.plan.installDepositCents).toBe(D);
    expect(step(v, "safety_check").state).toBe("paid");
    expect(step(v, "fixes").state).toBe("requested");
    expect(step(v, "repeat_safety_check").state).toBe("requested");
  });
  test("a newer fixes quote: the step follows the newest fixes invoice; money on the old one never counts", async () => {
    tables["quotes"]!.push({ id: QF0, job_id: J, kind: "rectification", status: "superseded", version: 1, customer_total_inc_gst: 300, accepted_at: "2026-10-22T01:00:00.000Z", created_at: "2026-10-22T00:00:00.000Z" });
    tables["invoices"]!.push(invoice(INVF0, "rectification", 300, { quote_id: QF0, xero_invoice_number: "INV-OLD", created_at: "2026-10-22T02:00:00.000Z" }));
    payXero(INVF0, 300);
    expect(await pay.fixesPaymentBlockerFor(J)).toContain("must be paid in full");
    const v = await pay.jobPaymentView(J, new Date(NOW));
    expect(v!.invoices.fixes!.id).toBe(INVF);
    expect(step(v, "fixes").state).toBe("requested");
    payXero(INVF, 550);
    expect(await pay.fixesPaymentBlockerFor(J)).toBeNull();
  });
  test("fixes scheduling gate opens only when the newest fixes invoice is paid in full", async () => {
    payXero(INV, 4000); // install paid in full never pays the fixes
    expect(await pay.fixesPaymentBlockerFor(J)).toContain("must be paid in full");
    payXero(INVF, 549.99);
    expect(await pay.fixesPaymentBlockerFor(J)).toContain("must be paid in full");
    payXero(INVF, 0.01);
    expect(await pay.fixesPaymentBlockerFor(J)).toBeNull();
  });
  test("bank reference for the fixes = the fixes invoice number; the install steps keep the install number", async () => {
    payXero(INV, 349);
    const v = await pay.jobPaymentView(J, new Date(NOW));
    expect(v!.due.step!.key).toBe("fixes");
    expect(v!.payNow.lines).toContain("Reference: INV-FIX");
    expect(v!.payNow.lines.join(" ")).not.toContain("INV-0101");
    expect(v!.reference).toBe("INV-0101");
    expect(v!.references).toEqual({ install: "INV-0101", fixes: "INV-FIX", repeat: null });
  });
});

describe("fixes card stays on fixes", () => {
  beforeEach(() => seed());
  test("card checkout for the fixes carries the fixes invoice id and the fixes amount; afterwards the 10% is still unpaid and only asked for once the install is being booked", async () => {
    payXero(INV, 349);
    const r = await stripe.createStepCheckout(J, "https://hiv.test/my-job/x", null);
    expect("url" in r).toBe(true);
    const s = sessions.at(-1)!;
    expect(s["metadata[step]"]).toBe("fixes");
    expect(s["metadata[invoice_id]"]).toBe(INVF);
    expect(s["payment_intent_data[metadata][invoice_id]"]).toBe(INVF);
    expect(s["line_items[0][price_data][unit_amount]"]).toBe("55000");
    // The webhook records the card money on the fixes invoice only.
    expect(await stripe.recordStripePayment({ eventId: "evt_1", livemode: true, jobId: J, invoiceId: s["metadata[invoice_id]"]!, step: "fixes", amountCents: 55_000, paidAt: NOW, paymentIntentId: "pi_fixes_000001", sessionId: "cs_1", email: null, chargeId: "ch_fixes_000001" })).toBe("recorded");
    const card = tables["workflow_events"]!.filter((e) => e["event_type"] === "owner_payment_recorded" && (e["details"] as { source?: string }).source === "card");
    expect(card.map((e) => (e["details"] as { invoice_id: string }).invoice_id)).toEqual([INVF]);
    expect(Number(tables["invoices"]!.find((i) => i["id"] === INVF)!["total_paid"])).toBe(550);
    expect(Number(tables["invoices"]!.find((i) => i["id"] === INV)!["total_paid"])).toBe(0);
    expect(await pay.fixesPaymentBlockerFor(J)).toBeNull();
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "fixes_payment_received").map((e) => (e["details"] as { invoice_id: string }).invoice_id)).toEqual([INVF]);
    expect(fixesBooked).toContain(J);
    let v = await pay.jobPaymentView(J, new Date(NOW));
    expect(v!.paid).toEqual({ install: S, fixes: 55_000, repeat: 0 });
    expect(step(v, "install_deposit").state).toBe("not_yet");
    expect(step(v, "install_deposit").outstandingCents).toBe(D);
    expect(v!.due.step).toBeNull();
    setStage("installation_scheduling");
    v = await pay.jobPaymentView(J, new Date(NOW));
    expect(step(v, "install_deposit").state).toBe("requested");
    expect(v!.due.step!.key).toBe("install_deposit");
    expect(v!.due.dueNowCents).toBe(D);
    // The deposit card goes on the install invoice.
    await stripe.createStepCheckout(J, "https://hiv.test/my-job/x", null);
    expect(sessions.at(-1)!["metadata[invoice_id]"]).toBe(INV);
    expect(sessions.at(-1)!["line_items[0][price_data][unit_amount]"]).toBe(String(D));
  });
});

describe("deposit waits for fixes done", () => {
  beforeEach(() => seed());
  test("fixes paid but not yet done → the 10% step is not_yet (never requested); requested only after the fixes are done", async () => {
    payXero(INV, 349); payXero(INVF, 550);
    for (const stage of ["rectification_scheduling", "rectification_booked"]) {
      setStage(stage);
      const v = await pay.jobPaymentView(J, new Date(NOW));
      expect(step(v, "install_deposit").state).toBe("not_yet");
      expect(step(v, "install_deposit").requestedAt).toBeNull();
      expect(v!.due.step).toBeNull();
    }
    setStage("piesa_complete"); // PIESA found fixes, Section C not signed yet
    expect(step(await pay.jobPaymentView(J, new Date(NOW)), "install_deposit").state).toBe("not_yet");
    tables["piesa_records"]![0]!["section_c_signed_at"] = "2026-10-28T00:00:00.000Z"; // fixes done and signed off
    const v = await pay.jobPaymentView(J, new Date(NOW));
    expect(step(v, "install_deposit").state).toBe("requested");
    expect(v!.due.step!.key).toBe("install_deposit");
  });
});

describe("old-model path: fixes accepted BEFORE any installation quote", () => {
  test("no installation invoice yet: the fixes gate reads the fixes invoice; paying it opens the gate and the fixes step's effects run", async () => {
    seed({ installInvoice: false, fixesFirst: true });
    tables["quotes"]![0]!["status"] = "issued"; tables["quotes"]![0]!["accepted_at"] = null;
    setStage("awaiting_quote_acceptance");
    expect(await pay.jobPaymentView(J, new Date(NOW))).toBeNull();
    expect(await pay.fixesPaymentBlockerFor(J)).toContain("must be paid in full");
    payXero(INVF, 550);
    expect(await pay.fixesPaymentBlockerFor(J)).toBeNull();
    await pay.afterPaymentsChanged(J, INVF, null);
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "fixes_payment_received").length).toBe(1);
    expect(fixesBooked).toEqual([J]);
    await pay.afterPaymentsChanged(J, INVF, null);
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "fixes_payment_received").length).toBe(1);
  });
  test("installation quote accepted afterwards: the fixes are their own step (never folded), paid only on the fixes invoice", async () => {
    seed({ fixesFirst: true });
    payXero(INV, 349);
    const v = await pay.jobPaymentView(J, new Date(NOW));
    expect(v!.plan.fixesCents).toBe(55_000);
    expect(v!.plan.quoteTotalCents).toBe(400_000);
    expect(step(v, "fixes").state).toBe("requested");
    expect(step(v, "fixes").amountCents).toBe(55_000);
    expect(await pay.fixesPaymentBlockerFor(J)).toContain("must be paid in full");
    payXero(INV, 550); // money on the install invoice never pays the fixes
    expect(await pay.fixesPaymentBlockerFor(J)).toContain("must be paid in full");
    payXero(INVF, 550);
    expect(await pay.fixesPaymentBlockerFor(J)).toBeNull();
    expect(step(await pay.jobPaymentView(J, new Date(NOW)), "fixes").state).toBe("paid");
  });
});

describe("repeat safety check: own invoice, own card checkout", () => {
  beforeEach(() => seed({ fixes: false }));
  test("repeat visit booking waits for the repeat invoice: install money never moves it; the card checkout carries the repeat invoice and the webhook passes its paid amount", async () => {
    setStage("installation_scheduling");
    addRepeat();
    payXero(INV, 4000); // install paid in full
    let v = await pay.jobPaymentView(J, new Date(NOW));
    expect(step(v, "repeat_safety_check").state).toBe("requested");
    expect(v!.due.step!.key).toBe("repeat_safety_check");
    expect(v!.payNow.lines).toContain("Reference: INV-REP");
    await stripe.createStepCheckout(J, "https://hiv.test/my-job/x", null);
    const s = sessions.at(-1)!;
    expect(s["metadata[step]"]).toBe("repeat_safety_check");
    expect(s["metadata[invoice_id]"]).toBe(INVR);
    expect(s["line_items[0][price_data][unit_amount]"]).toBe("22000");
    // A card payment that landed on the install invoice never pays the repeat.
    await stripe.recordStripePayment({ eventId: "evt_0", livemode: true, jobId: J, invoiceId: INV, step: "repeat_safety_check", amountCents: 22_000, paidAt: NOW, paymentIntentId: "pi_wrong_0000001", sessionId: "cs_0", email: null, chargeId: "ch_wrong_0000001" });
    expect(tables["workflow_events"]!.some((e) => e["event_type"] === "repeat_piesa_paid")).toBe(false);
    expect(offers).toEqual([]);
    expect(await stripe.recordStripePayment({ eventId: "evt_2", livemode: true, jobId: J, invoiceId: INVR, step: "repeat_safety_check", amountCents: 22_000, paidAt: NOW, paymentIntentId: "pi_repeat_000001", sessionId: "cs_2", email: null, chargeId: "ch_repeat_000001" })).toBe("recorded");
    expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "repeat_piesa_paid").length).toBe(1);
    expect(offers).toEqual([J]);
    v = await pay.jobPaymentView(J, new Date(NOW));
    expect(step(v, "repeat_safety_check").state).toBe("paid");
    expect(v!.paid.repeat).toBe(22_000);
  });
  test("repeat paid in full on its Xero invoice → the step is paid; the deposit never sees that money", async () => {
    setStage("installation_scheduling");
    addRepeat(220);
    payXero(INV, 349);
    const v = await pay.jobPaymentView(J, new Date(NOW));
    expect(step(v, "repeat_safety_check").state).toBe("paid");
    expect(step(v, "install_deposit").outstandingCents).toBe(D);
  });
});

describe("owner pay card", () => {
  test("lists each step with its own amount and the due step's own reference", async () => {
    seed();
    addRepeat();
    payXero(INV, 349);
    const o = await resolveOwnerJob(TOKEN);
    const steps = o!.payment!.steps;
    expect(steps.map((s) => [s.key, s.amount])).toEqual([
      ["safety_check", 349], ["repeat_safety_check", 220], ["fixes", 550], ["install_deposit", 365.1], ["balance", 3285.9],
    ]);
    expect(o!.payment!.payNow.title).toContain("$220.00");
    expect(o!.payment!.payNow.lines).toContain("Reference: INV-REP");
    expect(o!.payment!.reference).toBe("INV-REP");
  });
});
