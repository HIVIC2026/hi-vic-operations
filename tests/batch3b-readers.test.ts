// Batch 3b Task 5: every reader that assumed ONE invoice per job now picks the right invoice — the installation invoice,
// the electrical fixes invoice ("… fixes") or the repeat safety check invoice ("… safety check 2"). REAL server modules
// against an in-memory database; `maybeSingle()` on invoices behaves like PostgREST (several rows = an error).
import { describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000j5";
const QI = "00000000-0000-4000-8000-0000000000q1", QI0 = "00000000-0000-4000-8000-0000000000q0", QF = "00000000-0000-4000-8000-0000000000q2";
const INV = "00000000-0000-4000-8000-0000000000i1", INV0 = "00000000-0000-4000-8000-0000000000i0", INVF = "00000000-0000-4000-8000-0000000000i2", INVR = "00000000-0000-4000-8000-0000000000i3";
const KEY = "reopen:2026-10-25T01:00:00.000Z";
const tables: Tables = {};
let clock = Date.parse("2026-10-28T00:00:00Z");
const nextAt = () => new Date((clock += 1000)).toISOString();

/** PostgREST: maybeSingle() over several rows is an error ("JSON object requested, multiple rows returned"). */
function strictInvoices(q: Record<string, unknown> & { run: () => Promise<{ data: unknown; error: unknown }> }) {
  let one = false;
  q["maybeSingle"] = () => { one = true; return q; };
  q["then"] = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => q.run().then((r) => {
    if (!one || !Array.isArray(r.data)) return r;
    return r.data.length > 1 ? { data: null, error: { message: "JSON object requested, multiple (or no) rows returned" } } : { data: r.data[0] ?? null, error: null };
  }).then(res, rej);
  return q;
}
const from = (t: string) => { const q = memoryPostgrest(tables).from(t); return t === "invoices" ? strictInvoices(q) : q; };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from, rpc: async () => ({ data: null, error: null }) } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  WorkflowError: class extends Error {}, paymentGateActiveForJob: async () => true,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: nextAt() }); },
}));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => null }));

const pay = await import("../src/lib/payments.server");
const { assignmentPaymentFacts } = await import("../src/lib/assignment.server");
const { installerPayHeldReasonsFor } = await import("../src/lib/installer-pay-timing.server");
const { payoutGateFacts } = await import("../src/lib/trade-payout-gate.server");
const { electricianPayTiming } = await import("../src/lib/electrician-pay.core");
const { moneyInvoices } = await import("../src/lib/office-money.server");
const { jobPaymentStalls, paymentStallLine } = await import("../src/lib/payment-stall.core");
const { buildNeedsRows } = await import("../src/lib/office-needs.core");
const { paymentDates } = await import("../src/lib/job-status.core");
const { invoiceSlotLabel } = await import("../src/lib/office-money.core");

const invoice = (id: string, kind: string, total: number, extra: Record<string, unknown> = {}) => ({
  id, job_id: J, kind, quote_id: null, repeat_key: null, status: "deposit_due", total_inc_gst: total, total_paid: 0, deposit_amount: total, balance_amount: 0,
  xero_invoice_id: `x-${id.slice(-2)}`, xero_invoice_number: null, xero_reference: null, xero_online_url: null, balance_due_date: null, amount_paid: null, paid_at: null, balance_paid_at: null, updated_at: null,
  created_at: "2026-10-20T01:00:00.000Z", ...extra,
});
const ev = (type: string, at: string, details: unknown, extra: Record<string, unknown> = {}) => tables["workflow_events"]!.push({ id: `seed-${tables["workflow_events"]!.length}`, job_id: J, actor_id: null, event_type: type, summary: type, details, created_at: at, ...extra });
let pn = 0;
const payXero = (invoiceId: string, dollars: number, at = nextAt()) => ev("owner_payment_recorded", at, { invoice_id: invoiceId, amount_cents: Math.round(dollars * 100), source: "xero", paid_at: at, xero_payment_id: `xp-${++pn}`, receipt_key: `xero:${invoiceId}:xp-${pn}` });

/** A job with an install invoice, a paid-or-not fixes invoice and an owner-paid repeat safety check invoice. */
function seed(opts: { channel?: string; installPaid?: number; fixesPaid?: number; twoInstall?: boolean } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    owners: [{ id: "o1", full_name: "Pat Smith", email: "pat@example.com" }],
    properties: [{ id: "p1", address_line: "1 Test St", suburb: "Testville", state: "VIC", postcode: "3000" }],
    jobs: [{ id: J, job_number: "HV-0505", business_unit: "hivic", source: "website", stage: "installation_scheduling", owner_id: "o1", property_id: "p1", channel: opts.channel ?? "hivic_sourced", external_refs: {}, deleted_at: null, installation_completed_at: null }],
    quotes: [
      ...(opts.twoInstall ? [{ id: QI0, job_id: J, kind: "installation", status: "superseded", customer_total_inc_gst: 3900, version: 1, accepted_at: "2026-10-18T01:00:00.000Z", created_at: "2026-10-18T00:00:00.000Z" }] : []),
      { id: QI, job_id: J, kind: "installation", status: "accepted", release_state: "released", customer_total_inc_gst: 4000, veec_discount_inc_gst: 749, subtotal_inc_gst: 4749, version: 2, accepted_at: "2026-10-20T01:00:00.000Z", created_at: "2026-10-19T00:00:00.000Z" },
      { id: QF, job_id: J, kind: "rectification", status: "accepted", version: 1, customer_total_inc_gst: 550, accepted_at: "2026-10-23T01:00:00.000Z", created_at: "2026-10-23T00:00:00.000Z" },
    ],
    quote_items: [{ id: "qi-1", quote_id: QI, code: "PIESA", description: "PIESA", quantity: 1, line_total_inc_gst: 349, sort: 1 }],
    invoices: [
      ...(opts.twoInstall ? [invoice(INV0, "installation", 3900, { quote_id: QI0, xero_invoice_number: "INV-OLD", xero_reference: "Home Insulation Victoria HV-0505", status: "deposit_paid", amount_paid: 349, created_at: "2026-10-18T02:00:00.000Z" })] : []),
      invoice(INV, "installation", 4000, { quote_id: QI, deposit_amount: 349, balance_amount: 3651, xero_invoice_number: "INV-0101", xero_reference: "Home Insulation Victoria HV-0505", total_paid: opts.installPaid ?? 0, amount_paid: opts.installPaid ?? 0, status: (opts.installPaid ?? 0) >= 4000 ? "fully_paid" : "deposit_due", ...((opts.installPaid ?? 0) >= 4000 ? { paid_at: "2026-10-26T00:00:00.000Z", balance_paid_at: "2026-10-26T00:00:00.000Z" } : {}) }),
      invoice(INVF, "rectification", 550, { quote_id: QF, xero_invoice_number: "INV-FIX", xero_reference: "Home Insulation Victoria HV-0505 fixes", total_paid: opts.fixesPaid ?? 0, status: (opts.fixesPaid ?? 0) >= 550 ? "fully_paid" : "deposit_due", created_at: "2026-10-23T02:00:00.000Z" }),
      invoice(INVR, "repeat_safety_check", 220, { repeat_key: KEY, xero_invoice_number: "INV-REP", xero_reference: "Home Insulation Victoria HV-0505 safety check 2", created_at: "2026-10-25T01:03:00.000Z" }),
    ],
    workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349, office_time_limits: {}, piesa_install_window_days: 30 }],
    piesa_records: [{ id: "pr-1", job_id: J, kind: "post_rectification", outcome: "pass", section_c_signed_at: "2026-10-26T00:00:00.000Z", is_current: true, created_at: "2026-10-26T00:00:00.000Z" }],
    bookings: [], payment_overrides: [], workflow_events: [],
    assessments: [], installer_declarations: [],
  });
  ev("piesa_superseded_on_reopen", "2026-10-25T01:00:00.000Z", { key: KEY, had_check: true });
  ev("repeat_piesa_payer_chosen", "2026-10-25T01:01:00.000Z", { deadline: KEY, payer: "owner", price_inc_gst: 220, suggestion: null });
  ev("repeat_piesa_accepted", "2026-10-25T01:02:00.000Z", { deadline: KEY, payer: "owner", owner_charge_inc_gst: 220 });
}

describe("assignment read (VEEC form payment facts)", () => {
  test("install + fixes + repeat rows (and an older install invoice) → no error; the newest installation invoice", async () => {
    seed({ twoInstall: true });
    const f = await assignmentPaymentFacts(J);
    expect(f).toEqual({ status: "deposit_due", reference: "INV-0101", amount_paid: 0 });
  });
});

describe("Needs me: one unpaid row per invoice", () => {
  const NOW = Date.parse("2026-10-30T00:00:00Z");
  const base = { now: NOW, installQuote: { accepted_at: "2026-10-20T01:00:00.000Z", customer_total_inc_gst: 4000 }, fixesQuote: { id: QF, accepted_at: "2026-10-23T01:00:00.000Z", customer_total_inc_gst: 550 }, safetyCents: 34_900, waived: false, depositSince: null, depositDueNow: false, repeat: null };
  const invs = (installPaid: number, fixesPaid: number) => [
    { id: INV, kind: "installation", quote_id: QI, total_inc_gst: 4000, total_paid: installPaid, created_at: "2026-10-20T01:00:00.000Z", xero_invoice_number: "INV-0101" },
    { id: INVF, kind: "rectification", quote_id: QF, total_inc_gst: 550, total_paid: fixesPaid, created_at: "2026-10-23T02:00:00.000Z", xero_invoice_number: "INV-FIX" },
  ];
  test("install $349 unpaid AND fixes unpaid → two stalls, each on its own invoice with its reference", () => {
    const s = jobPaymentStalls({ ...base, invoices: invs(0, 0) });
    expect(s.map((x) => [x.invoice, x.key, x.reference])).toEqual([["install", "safety_check", "INV-0101"], ["fixes", "fixes", "INV-FIX"]]);
  });
  test("fixes money never pays the $349; install money never pays the fixes", () => {
    expect(jobPaymentStalls({ ...base, invoices: invs(0, 550) }).map((x) => x.key)).toEqual(["safety_check"]);
    expect(jobPaymentStalls({ ...base, invoices: invs(4000, 0) }).map((x) => x.key)).toEqual(["fixes"]);
    expect(jobPaymentStalls({ ...base, invoices: invs(349, 550) })).toEqual([]);
  });
  test("the fixes stall reads the newest accepted fixes quote's own invoice (an old fixes invoice is ignored)", () => {
    const old = { id: "old", kind: "rectification", quote_id: "q-old", total_inc_gst: 550, total_paid: 550, created_at: "2026-10-24T00:00:00.000Z", xero_invoice_number: "INV-OLDFIX" };
    expect(jobPaymentStalls({ ...base, invoices: [...invs(349, 0), old] }).map((x) => [x.key, x.reference])).toEqual([["fixes", "INV-FIX"]]);
  });
  test("the repeat safety check stall is its own row (repeat invoice reference)", () => {
    const repeat = { cents: 22_000, acceptedAt: "2026-10-25T01:02:00.000Z", paid: false };
    const rep = { id: INVR, kind: "repeat_safety_check", quote_id: null, total_inc_gst: 220, total_paid: 0, created_at: "2026-10-25T01:03:00.000Z", xero_invoice_number: "INV-REP" };
    expect(jobPaymentStalls({ ...base, repeat, invoices: [...invs(349, 550), rep] }).map((x) => [x.invoice, x.reference])).toEqual([["repeat", "INV-REP"]]);
    expect(jobPaymentStalls({ ...base, repeat: { ...repeat, paid: true }, invoices: [...invs(349, 550), rep] })).toEqual([]);
  });
  test("Needs me shows the install unpaid row AND a fixes unpaid row (office labels + references)", () => {
    const stalls = jobPaymentStalls({ ...base, invoices: invs(0, 0) });
    const rows = buildNeedsRows({ now: NOW, jobs: [{ jobId: J, jobNumber: "HV-0505", surname: "Smith", suburb: "Testville", paymentStalls: stalls }] });
    const pays = rows.watch.filter((r) => r.jobId === J);
    expect(pays.map((r) => r.kind)).toEqual(["payment_stalled", "payment_stalled"]);
    expect(new Set(pays.map((r) => r.key)).size).toBe(2);
    expect(pays[0]!.line).toContain("INV-0101");
    expect(pays[1]!.line).toContain("Electrical fixes");
    expect(pays[1]!.line).toContain("INV-FIX");
    expect(paymentStallLine(stalls[1]!)).toBe(pays[1]!.line);
  });
  test("overdue rows: one per invoice, labelled with the invoice and its reference", () => {
    const rows = buildNeedsRows({ now: NOW, jobs: [{ jobId: J, jobNumber: "HV-0505", surname: "Smith", suburb: null, paymentsOverdue: [
      { at: "2026-10-26T00:00:00.000Z", text: "$3,651 owing", invoice: "install", reference: "INV-0101" },
      { at: "2026-10-27T00:00:00.000Z", text: "$550 owing", invoice: "fixes", reference: "INV-FIX" },
    ] }] });
    expect(rows.watch.map((r) => r.line)).toEqual(["Payment overdue · chase · Install INV-0101 · $3,651 owing", "Payment overdue · chase · Electrical fixes INV-FIX · $550 owing"]);
  });
  test("a more urgent row still comes first and hides the payment rows (one row per job otherwise)", () => {
    const rows = buildNeedsRows({ now: NOW, jobs: [{ jobId: J, jobNumber: "HV-0505", surname: "Smith", suburb: null, finalCheck: { at: "2026-10-26T00:00:00.000Z", flags: 0 }, paymentStalls: jobPaymentStalls({ ...base, invoices: invs(0, 0) }) }] });
    expect([...rows.today, ...rows.week, ...rows.watch].map((r) => r.kind)).toEqual(["final_check"]);
  });
  test("a fixes / repeat invoice row (failed, old fixes invoice) never hides the install unpaid row, and vice versa", () => {
    const install = jobPaymentStalls({ ...base, fixesQuote: null, invoices: invs(0, 0) });
    const one = (extra: Record<string, unknown>) => { const r = buildNeedsRows({ now: NOW, jobs: [{ jobId: J, jobNumber: "HV-0505", surname: "Smith", suburb: null, ...extra }] }); return [...r.today, ...r.week, ...r.watch].map((x) => x.kind); };
    expect(one({ invoiceFailed: { at: "2026-10-28T00:00:00.000Z", text: "x", kind: "rectification" }, paymentStalls: install })).toEqual(["invoice_failed", "payment_stalled"]);
    expect(one({ invoiceFailed: { at: "2026-10-28T00:00:00.000Z", text: "x", kind: "repeat_safety_check" }, paymentStalls: install })).toEqual(["invoice_failed", "payment_stalled"]);
    expect(one({ oldFixesInvoiceUnpaid: { at: "2026-10-28T00:00:00.000Z" }, paymentStalls: install })).toEqual(["old_fixes_invoice_unpaid", "payment_stalled"]);
    // vice versa: the install invoice's rows keep a fixes unpaid row visible
    const fixes = jobPaymentStalls({ ...base, invoices: invs(349, 0) });
    expect(one({ invoiceFailed: { at: "2026-10-28T00:00:00.000Z", text: "x", kind: "installation" }, paymentStalls: fixes })).toEqual(["invoice_failed", "payment_stalled"]);
    expect(one({ paymentNotInXero: { at: "2026-10-28T00:00:00.000Z", text: "Deposit $365" }, paymentStalls: fixes })).toEqual(["payment_not_in_xero", "payment_stalled"]);
    // the same invoice: still one row
    expect(one({ invoiceFailed: { at: "2026-10-28T00:00:00.000Z", text: "x", kind: "installation" }, paymentStalls: install })).toEqual(["invoice_failed"]);
  });
  test("office labels: Install / Electrical fixes / Safety check N from the reference", () => {
    expect(invoiceSlotLabel("install", null)).toBe("Install");
    expect(invoiceSlotLabel("fixes", "Home Insulation Victoria HV-0505 fixes")).toBe("Electrical fixes");
    expect(invoiceSlotLabel("repeat", "Home Insulation Victoria HV-0505 safety check 3")).toBe("Safety check 3");
    expect(invoiceSlotLabel("repeat", null)).toBe("Safety check 2");
  });
});

describe("installer pay waits for the INSTALL invoice only", () => {
  test("installer-supplied job: install invoice paid in full, fixes invoice unpaid → installer pay released (AP done)", async () => {
    seed({ channel: "installer_sourced", installPaid: 4000, fixesPaid: 0 });
    ev("stage_changed", "2026-10-27T00:00:00.000Z", {}, { to_stage: "ready_for_veec" });
    expect(await installerPayHeldReasonsFor(J)).toEqual([]);
  });
  test("install invoice not paid in full → still held for the owner's payment", async () => {
    seed({ channel: "installer_sourced", installPaid: 349, fixesPaid: 550 });
    ev("stage_changed", "2026-10-27T00:00:00.000Z", {}, { to_stage: "ready_for_veec" });
    expect((await installerPayHeldReasonsFor(J)).join(" ")).toContain("owner to pay in full");
  });
});

describe("electrician fixes pay never waits for the owner's fixes invoice (decision 410)", () => {
  test("fixes invoice unpaid → still due 7 days after the office's approval, nothing held", async () => {
    seed({ installPaid: 4000, fixesPaid: 0 });
    const gate = { ...(await payoutGateFacts([J])).get(J)!, fixes: { sameVisitOnPiesa: false, outcome: "done" as const, detail: null, completedAt: "2026-10-26T00:00:00.000Z" }, electricianApprovedAt: { assessment: null, rectification: "2026-10-27T00:00:00.000Z" } };
    const t = electricianPayTiming("rectification", gate);
    expect(t.waiting).toEqual([]);
    expect(t.dueAt).toBe("2026-11-03T00:00:00.000Z");
  });
});

describe("job status: fixes paid date from the fixes invoice", () => {
  test("an old unpaid fixes invoice doesn't hide the current paid one; install/repeat invoices never count", () => {
    const d = paymentDates([
      { kind: "installation", status: "deposit_due", deposit_paid_at: null, balance_paid_at: null, paid_at: null, created_at: "2026-10-20T00:00:00.000Z" },
      { kind: "rectification", status: "deposit_due", deposit_paid_at: null, balance_paid_at: null, paid_at: null, created_at: "2026-10-22T00:00:00.000Z" },
      { kind: "rectification", status: "fully_paid", deposit_paid_at: null, balance_paid_at: null, paid_at: "2026-10-24T00:00:00.000Z", created_at: "2026-10-23T00:00:00.000Z" },
      { kind: "repeat_safety_check", status: "fully_paid", deposit_paid_at: null, balance_paid_at: null, paid_at: "2026-10-25T00:00:00.000Z", created_at: "2026-10-25T00:00:00.000Z" },
    ], []);
    expect(d.fixesPaidAt).toBe("2026-10-24T00:00:00.000Z");
    expect(d.finalHalfPaidAt).toBeNull();
  });
});

describe("office: each invoice listed on its own, with its reference", () => {
  test("Two separate payments: a card + Xero pair on the FIXES invoice is listed with that invoice and its reference", async () => {
    seed({ installPaid: 349 });
    ev("owner_payment_recorded", "2026-10-24T03:00:00.000Z", { invoice_id: INVF, amount_cents: 55_000, source: "card", paid_at: "2026-10-24T03:00:00.000Z", note: "stripe:pi_3Fix", stripe_payment_intent: "pi_3Fix" });
    ev("owner_payment_recorded", "2026-10-26T03:00:00.000Z", { invoice_id: INVF, amount_cents: 55_000, source: "xero", paid_at: "2026-10-26T03:00:00.000Z", xero_payment_id: "xf1" });
    const v = (await pay.jobPaymentView(J))!;
    expect(v.unclearPairs.map((u) => [u.invoiceId, u.invoice, u.reference, u.pairKey])).toEqual([[INVF, "fixes", "INV-FIX", "pi_3Fix|xf1"]]);
  });
  test("office Money lists three invoices (install, fixes, safety check 2) with their own totals, money and references", async () => {
    seed({ installPaid: 349 });
    payXero(INV, 349);
    payXero(INVF, 550);
    const r = await moneyInvoices(new Date("2026-10-29T00:00:00Z"));
    const mine = r.rows.filter((x) => x.jobId === J).map((x) => ({ id: x.invoiceId, label: x.label, number: x.invoiceNumber, reference: x.reference, total: x.totalCents, paid: x.paidCents }));
    expect(mine).toEqual([
      { id: INV, label: "Install", number: "INV-0101", reference: "Home Insulation Victoria HV-0505", total: 400_000, paid: 34_900 },
      { id: INVF, label: "Electrical fixes", number: "INV-FIX", reference: "Home Insulation Victoria HV-0505 fixes", total: 55_000, paid: 55_000 },
      { id: INVR, label: "Safety check 2", number: "INV-REP", reference: "Home Insulation Victoria HV-0505 safety check 2", total: 22_000, paid: 0 },
    ]);
    expect(r.owedCents).toBe(400_000 - 34_900 + 22_000);
  });
  test("a job with a fixes invoice but no installation invoice (fixes accepted first) is still listed", async () => {
    seed();
    tables["invoices"] = tables["invoices"]!.filter((i) => i["kind"] === "rectification");
    const r = await moneyInvoices(new Date("2026-10-29T00:00:00Z"));
    expect(r.rows.filter((x) => x.jobId === J).map((x) => [x.invoiceId, x.label, x.invoiceNumber, x.reference, x.totalCents, x.paidCents, x.state])).toEqual([[INVF, "Electrical fixes", "INV-FIX", "Home Insulation Victoria HV-0505 fixes", 55_000, 0, "On track"]]);
    expect(r.openCount).toBe(1);
  });
});

describe("partner job cards (pilot.functions): deposit cleared comes from the install invoice only", () => {
  test("the invoice_status read is limited to kind 'installation', newest first", async () => {
    const src = (await import("node:fs")).readFileSync("src/lib/pilot.functions.ts", "utf8");
    const read = src.split("\n").find((l) => l.includes(`admin.from("invoice_status" as never).select("job_id, deposit_cleared"`)) ?? "";
    expect(read).toContain(`.eq("kind" as never, "installation" as never)`);
    expect(read).toContain(`.order("created_at" as never, { ascending: false })`);
  });
});
