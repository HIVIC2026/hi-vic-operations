// Audit R07 / F03: electrical fixes approved AFTER the installation quote go onto the SAME Xero invoice. The REAL
// xero.server + payments.server run against an in-memory database and a mocked Xero HTTP gateway (global fetch), so the
// full path is exercised: tenant routing, business-unit barrier, sync lock, GET/POST /Invoices, the local invoice row,
// the payment ledger and the owner's payment plan. Never reaches the network.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { buildInvoicePayload, VEEC_INCENTIVE_TAX_TYPE } from "../src/lib/xero.core";
import {
  amendedInvoicePatch, buildRepairsAmendment, REPAIRS_ADDED_EVENT, REPAIRS_HELD_EVENT, REPAIRS_PAID_HOLD, REPAIRS_SWITCHED_OFF,
  repairsAmendDecision, repairsKey, repairsTag, verifyRepairsAmendment, type XeroInvoiceForRepairs,
} from "../src/lib/xero-repairs.core";
import { planQuoteTotalCents as planQuoteTotalCentsForTest } from "../src/lib/payments.core";
import { mittiOfficeItems } from "../src/lib/ready-check-chase.core";
import { NEEDS_TEXT } from "../src/lib/allocation.core";

// ---------- in-memory database ----------
const J = "00000000-0000-4000-8000-0000000000j1", QI = "00000000-0000-4000-8000-0000000000q1", QR = "00000000-0000-4000-8000-0000000000r1";
const INV = "00000000-0000-4000-8000-0000000000i1", XID = "xero-inv-0001";
let tables: Tables = {};
const db = memoryPostgrest(tables);
const proxy = { from: (t: string) => memoryPostgrest(tables).from(t), rpc: db.rpc };
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: proxy }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  paymentGateActiveForJob: async () => true,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => {
    tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: new Date(Date.now() + tables["workflow_events"]!.length).toISOString() });
  },
}));
// Downstream effects of a payment (emails, fixes booking, auto-advance) are other modules' business — no-ops here.
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => undefined }));
mock.module("../src/lib/owner-email-triggers.server", () => ({ onSafetyCheckPaid: async () => undefined }));
mock.module("../src/lib/owner-fixes.server", () => ({ bookPickedFixesTime: async () => undefined }));
mock.module("../src/lib/install-booked-email.server", () => ({ emailOwnerInstallBooked: async () => undefined }));

const xs = await import("../src/lib/xero.server");
const { jobPaymentView } = await import("../src/lib/payments.server");

// ---------- mocked Xero HTTP (connector gateway) ----------
type XInv = XeroInvoiceForRepairs & { InvoiceNumber?: string; AmountDue?: number; Payments: { PaymentID: string; Amount: number; Date: string; Status?: string }[] };
let xero: XInv;
const posts: { path: string; key: string | undefined; body: any }[] = [];
const seenKeys = new Map<string, any>();
let refuseNext = false;
const sum = (lines: any[]) => Math.round(lines.reduce((s, l) => s + Math.round(Number(l.Quantity) * Number(l.UnitAmount) * 100), 0)) / 100;
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = new URL(String(input));
  if (!url.href.startsWith("https://connector-gateway.lovable.dev/xero")) throw new Error(`network blocked: ${url.href}`);
  const path = url.pathname.replace(/^\/xero/, "");
  const method = init?.method ?? "GET";
  if (path === "/connections") return json([{ tenantId: "t-live", tenantName: "DC Construction Solutions Pty Ltd" }, { tenantId: "t-demo", tenantName: "Demo Company (AU)" }]);
  if ((init?.headers as Record<string, string>)["xero-tenant-id"] !== "t-live") return json({ Message: "wrong organisation" }, 403);
  if (path === `/api.xro/2.0/Invoices/${XID}` && method === "GET") return json({ Invoices: [structuredClone(xero)] });
  if (path === `/api.xro/2.0/Invoices/${XID}/OnlineInvoice`) return json({ OnlineInvoices: [{ OnlineInvoiceUrl: "https://in.xero.com/abc" }] });
  if (path === `/api.xro/2.0/Invoices/${XID}` && method === "POST") {
    const key = (init?.headers as Record<string, string>)["Idempotency-Key"];
    const body = JSON.parse(String(init?.body));
    posts.push({ path, key, body });
    if (key && seenKeys.has(key)) return json(seenKeys.get(key));
    if (refuseNext) { refuseNext = false; return json({ Message: "A validation exception occurred" }, 400); }
    // Xero's rule: an invoice with a payment (or not AUTHORISED) can't have its lines edited.
    if (xero.Status !== "AUTHORISED" || xero.Payments.some((p) => p.Status !== "DELETED")) return json({ Message: "This document cannot be edited as it has a payment or credit note allocated to it." }, 400);
    const sent = body.Invoices[0].LineItems as any[];
    const known = new Map((xero.LineItems ?? []).map((l) => [l.LineItemID, l]));
    xero.LineItems = sent.map((l, n) => (l.LineItemID ? { ...known.get(l.LineItemID), ...l } : { ...l, LineItemID: `li-new-${n}` }));
    xero.Total = sum(xero.LineItems);
    xero.AmountDue = Math.round((xero.Total! - (xero.AmountPaid ?? 0)) * 100) / 100;
    const res = { Invoices: [structuredClone(xero)] };
    if (key) seenKeys.set(key, res);
    return json(res);
  }
  throw new Error(`unmocked Xero call ${method} ${path}`);
}) as unknown as typeof fetch;
process.env["LOVABLE_API_KEY"] = "test-lovable";
process.env["XERO_API_KEY"] = "test-xero";
afterAll(() => { globalThis.fetch = realFetch; });

const tracking = { categoryName: "Business Unit", optionName: "Home Insulation Victoria" };
function freshXeroInvoice(): XInv {
  const payload = buildInvoicePayload({ contactId: "c-1", jobNumber: "HV-0101", dueDate: "2026-11-20", total: 4000, items: [
    { description: "Pre Insulation Electrical Safety Assessment (PIESA)", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 },
    { description: "Ceiling insulation — 120 m²", quantity: 1, unit_price_inc_gst: 4400, line_total_inc_gst: 4400 },
  ], veecIncentive: 749, tracking, installationAddress: "1 Test St, Testville VIC 3000" });
  const inv = payload.Invoices[0]!;
  const lines = inv.LineItems.map((l, n) => ({ ...l, LineItemID: `li-${n}`, LineAmount: l.UnitAmount * l.Quantity, Tracking: l.Tracking?.map((t) => ({ ...t, TrackingCategoryID: "tc-1", TrackingOptionID: "to-1" })) }));
  return { InvoiceID: XID, InvoiceNumber: "INV-0101", Status: "AUTHORISED", Reference: inv.Reference, LineAmountTypes: "Inclusive", LineItems: lines, Total: 4000, AmountPaid: 0, AmountDue: 4000, Payments: [] } as unknown as XInv;
}
function pay(id: string, amount: number) {
  xero.Payments.push({ PaymentID: id, Amount: amount, Date: "2026-10-25T00:00:00" });
  xero.AmountPaid = Math.round(((xero.AmountPaid ?? 0) + amount) * 100) / 100;
  xero.AmountDue = Math.round((xero.Total! - xero.AmountPaid) * 100) / 100;
  if (xero.AmountDue <= 0) xero.Status = "PAID";
}

beforeEach(() => {
  posts.length = 0; seenKeys.clear(); refuseNext = false;
  xero = freshXeroInvoice();
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    jobs: [{ id: J, job_number: "HV-0101", business_unit: "hivic", source: "website", stage: "rectification_scheduling" }],
    quotes: [
      { id: QI, job_id: J, kind: "installation", status: "accepted", customer_total_inc_gst: 4000, accepted_at: "2026-10-20T01:00:00.000Z" },
      { id: QR, job_id: J, kind: "rectification", status: "accepted", customer_total_inc_gst: 550, accepted_at: "2026-10-24T01:00:00.000Z" },
    ],
    quote_items: [{ quote_id: QI, code: "PIESA", line_total_inc_gst: 349 }],
    invoices: [{ id: INV, job_id: J, quote_id: QI, kind: "installation", status: "deposit_due", total_inc_gst: 4000, total_paid: 0, deposit_amount: 349, balance_amount: 3651, deposit_pct: null,
      deposit_paid_at: null, balance_paid_at: null, deposit_due_date: "2026-10-20", balance_due_date: null, xero_invoice_id: XID, xero_invoice_number: "INV-0101", xero_reference: "Home Insulation Victoria HV-0101",
      xero_online_url: "https://in.xero.com/abc", xero_update_pending: false, sync_lock_at: null, last_synced_at: "2026-10-24T00:00:00.000Z", created_at: "2026-10-20T01:00:00.000Z" }],
    workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349 }],
    workflow_events: [], payment_overrides: [], bookings: [], external_sync_logs: [], owners: [],
  });
});
const invRow = () => tables["invoices"]![0]!;
const events = (t: string) => tables["workflow_events"]!.filter((e) => e.event_type === t);

describe("R07 acceptance: $4,000 installation + $550 later-approved fixes on the SAME Xero invoice", () => {
  test("the fixes line is added to the same invoice, totals $4,550, and portal/Xero totals and balance agree through to paid in full", async () => {
    const before = structuredClone(xero.LineItems!);
    expect(await xs.addRepairsToXeroInvoice(J, "owner-1")).toBe("added");
    // Same Xero invoice, every original line untouched (VEEC incentive still BAS Excluded), one fixes line added.
    expect(posts.length).toBe(1);
    expect(xero.InvoiceID).toBe(XID);
    expect(xero.Total).toBe(4550);
    expect(xero.LineItems!.slice(0, before.length)).toEqual(before);
    const veec = xero.LineItems!.find((l) => /VEEC incentive/.test(l.Description ?? ""))!;
    expect(veec.TaxType).toBe(VEEC_INCENTIVE_TAX_TYPE);
    const fixes = xero.LineItems!.at(-1)!;
    expect(fixes.Description).toStartWith("Home Insulation Victoria HV-0101 – Electrical fixes");
    expect(fixes.Description).toContain(repairsTag(QR));
    expect(fixes.UnitAmount).toBe(550);
    expect(fixes.Tracking).toEqual([{ Name: "Business Unit", Option: "Home Insulation Victoria" }]);
    // Portal invoice row = Xero's varied total; the owner's plan counts the fixes once and adds up to the same total.
    expect(Number(invRow()["total_inc_gst"])).toBe(4550);
    expect(Number(invRow()["balance_amount"])).toBe(4201);
    let v = (await jobPaymentView(J))!;
    expect(v.plan.quoteTotalCents).toBe(400_000);
    expect(v.plan.fixesCents).toBe(55_000);
    expect(v.plan.grandTotalCents).toBe(Math.round(xero.Total! * 100));
    expect(v.plan.installDepositCents).toBe(36_510); // 10% of ($4,000 − $349), unchanged by the fixes
    expect(v.due.remainingCents).toBe(Math.round(xero.AmountDue! * 100));
    expect(events(REPAIRS_ADDED_EVENT).length).toBe(1);
    expect(events(REPAIRS_ADDED_EVENT)[0]!.details).toMatchObject({ invoice_id: INV, rect_quote_id: QR, amount_cents: 55_000, total_before_cents: 400_000, total_after_cents: 455_000, basis: "amended" });

    // Idempotent: a second approval call, an office Sync and the poll never add it again.
    expect(await xs.addRepairsToXeroInvoice(J, null)).toBe("already");
    await xs.syncInvoiceFromXero(INV, null);
    expect(posts.length).toBe(1);
    expect(xero.LineItems!.filter((l) => (l.Description ?? "").includes(repairsTag(QR))).length).toBe(1);
    expect(events(REPAIRS_ADDED_EVENT).length).toBe(1);

    // Owner pays the safety check and the fixes, then the balance; the portal follows Xero exactly.
    pay("xp-1", 349); pay("xp-2", 550);
    await xs.syncInvoiceFromXero(INV, null);
    v = (await jobPaymentView(J))!;
    expect(v.paidCents).toBe(89_900);
    expect(v.steps.find((s) => s.key === "fixes")!.state).toBe("paid");
    expect(v.due.remainingCents).toBe(Math.round(xero.AmountDue! * 100));
    expect(invRow()["balance_paid_at"]).toBeNull();
    pay("xp-3", 3651);
    expect(xero.Status).toBe("PAID");
    await xs.syncInvoiceFromXero(INV, null);
    v = (await jobPaymentView(J))!;
    expect(v.paidCents).toBe(455_000);
    expect(v.due.remainingCents).toBe(0);
    expect(Number(invRow()["total_paid"])).toBe(4550);
    expect(invRow()["balance_paid_at"]).not.toBeNull(); // paid in full = the full varied total
    expect(events("balance_paid").length).toBe(1);
  });

  test("the $4,000 alone never reads as paid in full once the fixes are on the invoice", async () => {
    await xs.addRepairsToXeroInvoice(J, null);
    // Xero refuses edits once paid, so pay after the amendment: $4,000 leaves $550 owing on the one invoice.
    pay("xp-1", 4000);
    await xs.syncInvoiceFromXero(INV, null);
    expect(invRow()["balance_paid_at"]).toBeNull();
    expect((await jobPaymentView(J))!.due.remainingCents).toBe(55_000);
    expect(events("balance_paid").length).toBe(0);
  });
});

describe("R07 when Xero refuses the edit: held for the office, never a second invoice", () => {
  test("a payment already on the invoice → no write, one Needs me row; the office varies it in Xero → Sync adopts it and clears the row", async () => {
    pay("xp-1", 349);
    expect(await xs.addRepairsToXeroInvoice(J, null)).toBe("held");
    expect(posts.length).toBe(0); // pre-checked: no write that Xero would refuse
    expect(Number(invRow()["total_inc_gst"])).toBe(4000);
    expect(events(REPAIRS_HELD_EVENT).length).toBe(1);
    expect(events(REPAIRS_HELD_EVENT)[0]!.details).toMatchObject({ reason: REPAIRS_PAID_HOLD, needs_office: true });
    // The same hold is recorded once, however often Sync / the poll run.
    await xs.syncInvoiceFromXero(INV, null);
    await xs.addRepairsToXeroInvoice(J, null);
    expect(events(REPAIRS_HELD_EVENT).length).toBe(1);
    const ev = () => tables["workflow_events"]!.map((e) => ({ job_id: e.job_id, event_type: e.event_type, created_at: e.created_at, details: e.details, summary: e.summary }));
    expect(mittiOfficeItems(ev(), new Date()).map((i) => i.code)).toContain("xero_invoice_repairs_held");
    expect(NEEDS_TEXT.xero_invoice_repairs_held.next).toContain("SAME Xero invoice");
    // Office: remove the payment, add the fixes line by hand (own wording), re-apply the payment; then Sync.
    xero.LineItems = [...xero.LineItems!, { LineItemID: "li-office", Description: "Home Insulation Victoria HV-0101 – Electrical repairs", Quantity: 1, UnitAmount: 550, AccountCode: "200" }];
    xero.Total = 4550; xero.AmountDue = 4550 - 349;
    await xs.syncInvoiceFromXero(INV, null);
    expect(posts.length).toBe(0);
    expect(Number(invRow()["total_inc_gst"])).toBe(4550);
    expect(events(REPAIRS_ADDED_EVENT)[0]!.details).toMatchObject({ basis: "total_matches" });
    expect(mittiOfficeItems(ev(), new Date()).map((i) => i.code)).not.toContain("xero_invoice_repairs_held");
    expect((await jobPaymentView(J))!.plan.grandTotalCents).toBe(455_000);
    expect(tables["invoices"]!.length).toBe(1);
  });

  test("Xero refuses the write itself → held with Xero's reason, nothing local changes; a later Sync adds it and clears the row", async () => {
    refuseNext = true;
    expect(await xs.addRepairsToXeroInvoice(J, null)).toBe("held");
    expect(events(REPAIRS_HELD_EVENT)[0]!.details["reason"]).toMatch(/^Xero refused the edit: Xero 400/);
    expect(Number(invRow()["total_inc_gst"])).toBe(4000);
    expect(xero.Total).toBe(4000);
    await xs.syncInvoiceFromXero(INV, null);
    expect(xero.Total).toBe(4550);
    expect(Number(invRow()["total_inc_gst"])).toBe(4550);
    expect(events(REPAIRS_ADDED_EVENT).length).toBe(1);
  });

  test("no fixes approved after the installation quote (old model folded them in) → nothing is read or written", async () => {
    tables["quotes"]![1]!["accepted_at"] = "2026-10-19T01:00:00.000Z";
    expect(await xs.addRepairsToXeroInvoice(J, null)).toBe("none");
    expect(posts.length).toBe(0);
    expect((await jobPaymentView(J))!.plan.grandTotalCents).toBe(400_000);
  });

  test("not a Home Insulation Victoria job → refused before any Xero call (business-unit barrier)", async () => {
    tables["jobs"]![0]!["business_unit"] = "dc";
    await expect(xs.addRepairsToXeroInvoice(J, null)).rejects.toThrow(/not a Home Insulation Victoria job/);
    expect(posts.length).toBe(0);
  });

  test("a sync already running holds the lock → the approval path backs off; the next Sync adds the fixes", async () => {
    invRow()["sync_lock_at"] = new Date().toISOString();
    expect(await xs.addRepairsToXeroInvoice(J, null)).toBe("busy");
    expect(posts.length).toBe(0);
    invRow()["sync_lock_at"] = null;
    await xs.syncInvoiceFromXero(INV, null);
    expect(xero.Total).toBe(4550);
    expect(Number(invRow()["total_inc_gst"])).toBe(4550);
  });
});

describe("pure rules (xero-repairs.core)", () => {
  const key = repairsKey(INV, QR, 55_000);
  const base = { enabled: true, repairs: { rectQuoteId: QR, amountCents: 55_000 }, key, recorded: [], baseTotalCents: 400_000 };
  test("decisions", () => {
    const x = freshXeroInvoice();
    expect(repairsAmendDecision({ ...base, xero: x })).toEqual({ action: "amend" });
    expect(repairsAmendDecision({ ...base, repairs: null, key: null, xero: x })).toEqual({ action: "none" });
    expect(repairsAmendDecision({ ...base, recorded: [{ key, rectQuoteId: QR, amountCents: 55_000 }], xero: null })).toEqual({ action: "already", basis: "recorded" });
    expect(repairsAmendDecision({ ...base, recorded: [{ key: "other", rectQuoteId: QR, amountCents: 40_000 }], xero: x })).toMatchObject({ action: "hold" });
    expect(repairsAmendDecision({ ...base, enabled: false, xero: x })).toEqual({ action: "hold", reason: REPAIRS_SWITCHED_OFF });
    expect(repairsAmendDecision({ ...base, xero: { ...x, Status: "PAID" } })).toMatchObject({ action: "hold" });
    expect(repairsAmendDecision({ ...base, xero: { ...x, Status: "VOIDED" } })).toMatchObject({ action: "hold" });
    expect(repairsAmendDecision({ ...base, xero: { ...x, AmountPaid: 349 } })).toEqual({ action: "hold", reason: REPAIRS_PAID_HOLD });
    expect(repairsAmendDecision({ ...base, xero: { ...x, AmountCredited: 10 } })).toEqual({ action: "hold", reason: REPAIRS_PAID_HOLD });
    expect(repairsAmendDecision({ ...base, xero: { ...x, Total: 3900 } })).toMatchObject({ action: "hold" });
    expect(repairsAmendDecision({ ...base, xero: { ...x, Reference: "DC Construction 12" } })).toMatchObject({ action: "hold" });
    expect(repairsAmendDecision({ ...base, xero: { ...x, LineItems: [...x.LineItems!, { LineItemID: "z", Description: `x (${repairsTag(QR)})` }], Total: 4550, Status: "PAID" } })).toEqual({ action: "already", basis: "line_on_invoice" });
    expect(repairsAmendDecision({ ...base, xero: { ...x, Total: 4550, Status: "PAID" } })).toEqual({ action: "already", basis: "total_matches" });
    expect(repairsAmendDecision({ ...base, xero: null })).toMatchObject({ action: "hold" });
  });
  test("the edit sends every original line back unchanged plus ONE tracked line; live payloads must carry Business Unit tracking", () => {
    const x = freshXeroInvoice();
    const u = buildRepairsAmendment({ xero: x, jobNumber: "HV-0101", rectQuoteId: QR, amountCents: 55_000, key, mode: "live" });
    expect(u.path).toBe(`/api.xro/2.0/Invoices/${XID}`);
    expect(u.headers["Idempotency-Key"]).toBe(`hivic-${key.replace(/:/g, "-")}`);
    expect(u.body.Invoices[0]!.LineItems.slice(0, -1)).toEqual(x.LineItems!);
    expect(u.body.Invoices[0]!.LineItems.length).toBe(x.LineItems!.length + 1);
    expect(u.expectedTotalCents).toBe(455_000);
    const untracked = { ...x, LineItems: x.LineItems!.map(({ Tracking: _t, ...l }) => l) };
    expect(() => buildRepairsAmendment({ xero: untracked, jobNumber: "HV-0101", rectQuoteId: QR, amountCents: 55_000, key, mode: "live" })).toThrow(/Business Unit/);
  });
  test("Xero's answer is verified: total, every original line, and the fixes line", () => {
    const x = freshXeroInvoice();
    const good = { ...x, Total: 4550, LineItems: [...x.LineItems!, { LineItemID: "n", Description: `y (${repairsTag(QR)})` }] };
    expect(verifyRepairsAmendment(x, good, QR, 455_000)).toBeNull();
    expect(verifyRepairsAmendment(x, { ...good, Total: 4000 }, QR, 455_000)).toMatch(/total/);
    expect(verifyRepairsAmendment(x, { ...good, LineItems: good.LineItems.slice(1) }, QR, 455_000)).toMatch(/original/);
    expect(verifyRepairsAmendment(x, null, QR, 455_000)).toMatch(/no invoice/);
  });
  test("local row patch: varied total and balance; fully paid at the old total is not fully paid any more", () => {
    expect(amendedInvoicePatch({ total_inc_gst: 4000, total_paid: 4000, deposit_amount: 349, deposit_paid_at: "d", balance_paid_at: "b", status: "fully_paid" }, 455_000))
      .toEqual({ total_inc_gst: 4550, balance_amount: 4201, balance_paid_at: null, status: "deposit_paid" });
    expect(amendedInvoicePatch({ total_inc_gst: 4000, total_paid: 0, deposit_amount: 349, deposit_paid_at: null, balance_paid_at: null, status: "deposit_due" }, 455_000))
      .toEqual({ total_inc_gst: 4550, balance_amount: 4201 });
  });
  test("plan quote part: the fixes are counted once whether or not they are on the invoice yet", () => {
    expect(planQuoteTotalCentsForTest({ invoiceTotalCents: 455_000, quoteTotalCents: 400_000, fixesCents: 55_000 })).toBe(400_000);
    expect(planQuoteTotalCentsForTest({ invoiceTotalCents: 400_000, quoteTotalCents: 400_000, fixesCents: 55_000 })).toBe(400_000);
    expect(planQuoteTotalCentsForTest({ invoiceTotalCents: 400_000, quoteTotalCents: 400_000, fixesCents: 0 })).toBe(400_000);
    expect(planQuoteTotalCentsForTest({ invoiceTotalCents: 400_000, quoteTotalCents: null, fixesCents: 55_000 })).toBe(400_000);
  });
});
