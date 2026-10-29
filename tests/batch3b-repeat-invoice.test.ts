// Batch 3b Task 3: an owner-paid repeat safety check (after a reopen / lapsed 30-day window) gets its OWN Xero invoice
// ("Home Insulation Victoria <job> safety check 2", 3, 4…), never a line on the installation invoice. The REAL
// repeat-piesa.server + xero.server + office-needs server facts run against an in-memory database and a mocked Xero
// gateway (global fetch). Never reaches the network.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000j1";
const QI = "00000000-0000-4000-8000-0000000000q1";
const INV = "00000000-0000-4000-8000-0000000000i1";
const KEY1 = "reopen:2026-10-25T01:00:00.000Z", KEY2 = "reopen:2026-10-27T01:00:00.000Z";
const tables: Tables = {};
let clock = Date.parse("2026-10-29T00:00:00Z");
const nextAt = () => new Date((clock += 1000)).toISOString();
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: null, error: null }) } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  WorkflowError: class extends Error {}, paymentGateActiveForJob: async () => true,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: nextAt() }); },
}));
// Payments ledger: the reconciled amount is Xero's AmountPaid (the ledger itself is another module's business).
mock.module("../src/lib/payments.server", () => ({
  recordXeroPayments: async () => 0, reconciledInvoicePaidCents: async (_j: string, _i: string, o: { xeroAmountPaid?: number }) => Math.round(Number(o?.xeroAmountPaid ?? 0) * 100),
  flagUnclearPaymentMatches: async () => undefined, afterPaymentsChanged: async () => undefined,
}));
mock.module("../src/lib/install-days.server", () => ({ installDayContext: async () => null }));
const offers: string[] = [];
mock.module("../src/lib/allocation.server", () => ({ startPiesaAllocation: async (id: string) => { offers.push(id); return { offered: 1, exhausted: false }; } }));

const rps = await import("../src/lib/repeat-piesa.server");
const xs = await import("../src/lib/xero.server");
const { invoiceFailedFacts } = await import("../src/lib/office-needs.server");
const { needsCandidates } = await import("../src/lib/office-needs.core");
const { createInvoiceForJob } = await import("../src/lib/office-money.server");
const { PAYMENT_EVENT } = await import("../src/lib/payment-ledger.server");

// ---------- mocked Xero HTTP (connector gateway) ----------
type XInv = { InvoiceID: string; InvoiceNumber: string; Reference: string; Status: string; Contact: { ContactID: string }; LineItems: any[]; Total: number; AmountPaid: number; Payments: unknown[] };
let xero: XInv[] = [];
let failCreate = false;
const posts: { path: string; body: any }[] = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const sum = (lines: any[]) => Math.round(lines.reduce((s, l) => s + Math.round(Number(l.Quantity) * Number(l.UnitAmount) * 100), 0)) / 100;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = new URL(String(input));
  if (!url.href.startsWith("https://connector-gateway.lovable.dev/xero")) throw new Error(`network blocked: ${url.href}`);
  const path = url.pathname.replace(/^\/xero/, ""); const method = init?.method ?? "GET";
  if (path === "/connections") return json([{ tenantId: "t-live", tenantName: "DC Construction Solutions Pty Ltd" }, { tenantId: "t-demo", tenantName: "Demo Company (AU)" }]);
  if ((init?.headers as Record<string, string>)["xero-tenant-id"] !== "t-live") return json({ Message: "wrong organisation" }, 403);
  if (path === "/api.xro/2.0/TrackingCategories") return json({ TrackingCategories: [{ Name: "Projects", Status: "ACTIVE", Options: [{ Name: "Home Insulation Victoria", Status: "ACTIVE", TrackingOptionID: "to-1" }] }] });
  if (path === "/api.xro/2.0/Contacts" && method === "GET") return json({ Contacts: [{ ContactID: "c-1", ContactStatus: "ACTIVE" }] });
  if (path === "/api.xro/2.0/Invoices" && method === "GET") return json({ Invoices: structuredClone(xero) });
  if (path === "/api.xro/2.0/Invoices" && method === "POST") {
    const body = JSON.parse(String(init?.body));
    posts.push({ path, body });
    if (failCreate) return json({ Message: "Xero is down" }, 500);
    const p = body.Invoices[0];
    const n = xero.length + 1;
    const x: XInv = { InvoiceID: `x-${n}`, InvoiceNumber: `INV-${n}`, Reference: p.Reference, Status: "AUTHORISED", Contact: p.Contact, LineItems: p.LineItems, Total: sum(p.LineItems), AmountPaid: 0, Payments: [] };
    xero.push(x);
    return json({ Invoices: [structuredClone(x)] });
  }
  const one = /^\/api\.xro\/2\.0\/Invoices\/([^/]+)(\/OnlineInvoice)?$/.exec(path);
  if (one && one[2]) return json({ OnlineInvoices: [{ OnlineInvoiceUrl: "https://in.xero.com/abc" }] });
  if (one && method === "GET") return json({ Invoices: xero.filter((x) => x.InvoiceID === one[1]).map((x) => structuredClone(x)) });
  if (one && method === "POST") { posts.push({ path, body: JSON.parse(String(init?.body)) }); return json({ Message: "edits are not expected" }, 400); }
  throw new Error(`unmocked Xero call ${method} ${path}`);
}) as unknown as typeof fetch;
process.env["LOVABLE_API_KEY"] = "test-lovable"; process.env["XERO_API_KEY"] = "test-xero";
afterAll(() => { globalThis.fetch = realFetch; });

const ev = (type: string, at: string, details: unknown) => tables["workflow_events"]!.push({ id: `seed-${tables["workflow_events"]!.length + 1}`, job_id: J, actor_id: null, event_type: type, summary: type, details, created_at: at });
/** A reopen after a done safety check, and the office's payer choice for it. */
function reopen(key: string, payer: "owner" | "installer" | "hivic", price = 220) {
  const at = key.slice("reopen:".length);
  ev("piesa_superseded_on_reopen", at, { key, had_check: true });
  ev("repeat_piesa_payer_chosen", new Date(Date.parse(at) + 60_000).toISOString(), { deadline: key, payer, price_inc_gst: price, suggestion: null });
}

beforeEach(() => {
  failCreate = false; posts.length = 0; offers.length = 0;
  xero = [{ InvoiceID: "x-inst", InvoiceNumber: "INV-0101", Reference: "Home Insulation Victoria HV-0101", Status: "AUTHORISED", Contact: { ContactID: "c-1" }, LineItems: [], Total: 4000, AmountPaid: 349, Payments: [] }];
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    owners: [{ id: "o1", full_name: "Pat Smith", email: "pat@example.com", xero_contact_id: "c-1" }],
    properties: [{ id: "p1", address_line: "1 Test St", suburb: "Testville", state: "VIC", postcode: "3000" }],
    jobs: [{ id: J, job_number: "HV-0101", business_unit: "hivic", source: "website", stage: "piesa_and_install_window_pending", owner_id: "o1", property_id: "p1" }],
    quotes: [{ id: QI, job_id: J, kind: "installation", status: "accepted", option_label: "R5.0 ceiling insulation", customer_total_inc_gst: 4000, veec_discount_inc_gst: 749, accepted_at: "2026-10-20T01:00:00.000Z", created_at: "2026-10-20T00:00:00.000Z" }],
    quote_items: [],
    invoices: [{ id: INV, job_id: J, quote_id: QI, kind: "installation", status: "deposit_paid", total_inc_gst: 4000, total_paid: 349, deposit_amount: 349, balance_amount: 3651, deposit_pct: 0.0873,
      deposit_paid_at: "2026-10-20T02:00:00.000Z", balance_paid_at: null, deposit_due_date: "2026-10-20", balance_due_date: null, xero_invoice_id: "x-inst", xero_invoice_number: "INV-0101", xero_reference: "Home Insulation Victoria HV-0101",
      xero_invoice_status: "AUTHORISED", xero_online_url: "https://in.xero.com/abc", xero_update_pending: false, sync_lock_at: null, last_synced_at: "2026-10-24T00:00:00.000Z", last_sync_error: null, created_at: "2026-10-20T01:00:00.000Z", repeat_key: null }],
    piesa_records: [{ id: "pr-1", job_id: J, kind: "initial", outcome: "pass", is_current: true, created_at: "2026-10-21T00:00:00.000Z" }],
    partner_offers: [], workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349 }],
    workflow_events: [], external_sync_logs: [],
  });
});
const repeats = () => tables["invoices"]!.filter((i) => i["kind"] === "repeat_safety_check");
const creates = () => posts.filter((p) => p.path === "/api.xro/2.0/Invoices");
const install = () => tables["invoices"]!.find((i) => i["id"] === INV)!;
const paidEvents = () => tables["workflow_events"]!.filter((e) => e["event_type"] === "repeat_piesa_paid");

describe("owner accepts → the repeat safety check gets its own invoice", () => {
  test("ONE repeat_safety_check invoice, reference '… safety check 2', one line, total = price; accepting twice is still one", async () => {
    reopen(KEY1, "owner", 220);
    const installBefore = structuredClone(install());
    expect((await rps.acceptRepeatPiesa(J)).stage).toBe("owner_pay");
    expect((await rps.acceptRepeatPiesa(J)).stage).toBe("owner_pay");
    const r = repeats();
    expect(r.length).toBe(1);
    expect(r[0]!["quote_id"]).toBeNull();
    expect(r[0]!["repeat_key"]).toBe(KEY1);
    expect(Number(r[0]!["total_inc_gst"])).toBe(220);
    expect(r[0]!["xero_reference"]).toBe("Home Insulation Victoria HV-0101 safety check 2");
    expect(r[0]!["xero_invoice_id"]).toBeTruthy();
    expect(creates().length).toBe(1);
    const p = creates()[0]!.body.Invoices[0];
    expect(p.Reference).toBe("Home Insulation Victoria HV-0101 safety check 2");
    expect(p.LineItems.length).toBe(1);
    expect(p.LineItems[0].Description).toBe("Home Insulation Victoria HV-0101 safety check 2 – New safety check (PIESA) (repeat PIESA 2026-10-25)");
    expect(sum(p.LineItems)).toBe(220);
    // The installation invoice row and its Xero invoice are untouched.
    expect(install()).toEqual(installBefore);
    expect(posts.some((x) => x.path.startsWith("/api.xro/2.0/Invoices/"))).toBe(false);
  });

  test("createRepeatInvoice is once-only per (job, repeat key)", async () => {
    reopen(KEY1, "owner", 220);
    await rps.acceptRepeatPiesa(J);
    const a = await xs.createRepeatInvoice(J, KEY1, 220);
    const b = await xs.createRepeatInvoice(J, KEY1, 220);
    expect(a.invoiceId).toBe(b.invoiceId);
    expect(a.invoiceId).toBe(String(repeats()[0]!["id"]));
    expect(repeats().length).toBe(1);
    expect(creates().length).toBe(1);
  });

  test("second repeat: another reopen → '… safety check 3'; the first repeat invoice is untouched", async () => {
    reopen(KEY1, "owner", 220);
    await rps.acceptRepeatPiesa(J);
    const first = structuredClone(repeats()[0]!);
    const firstX = structuredClone(xero.find((x) => x.InvoiceID === first["xero_invoice_id"])!);
    reopen(KEY2, "owner", 250);
    expect((await rps.acceptRepeatPiesa(J)).stage).toBe("owner_pay");
    const r = repeats();
    expect(r.length).toBe(2);
    const second = r.find((i) => i["repeat_key"] === KEY2)!;
    expect(second["xero_reference"]).toBe("Home Insulation Victoria HV-0101 safety check 3");
    expect(Number(second["total_inc_gst"])).toBe(250);
    expect(second["xero_invoice_id"]).not.toBe(first["xero_invoice_id"]);
    expect(r.find((i) => i["repeat_key"] === KEY1)).toEqual(first);
    expect(xero.find((x) => x.InvoiceID === first["xero_invoice_id"])).toEqual(firstX);
    expect(creates().length).toBe(2);
  });

  test("installer / Home Insulation Victoria payers → no invoice", async () => {
    for (const payer of ["installer", "hivic"] as const) {
      for (const k of ["workflow_events"]) tables[k] = [];
      reopen(KEY1, payer, 220);
      expect((await rps.acceptRepeatPiesa(J)).stage).toBe("offer");
    }
    expect(repeats().length).toBe(0);
    expect(creates().length).toBe(0);
  });
});

describe("the repeat counts paid from ITS invoice", () => {
  test("Xero: fully paid repeat invoice → recorded paid once and the PIESA offer starts", async () => {
    reopen(KEY1, "owner", 220);
    await rps.acceptRepeatPiesa(J);
    const r = repeats()[0]!;
    const x = xero.find((i) => i.InvoiceID === r["xero_invoice_id"])!;
    x.AmountPaid = 100;
    await xs.syncInvoiceFromXero(String(r["id"]), null);
    expect(paidEvents().length).toBe(0);
    x.AmountPaid = 220;
    await xs.syncInvoiceFromXero(String(r["id"]), null);
    await xs.syncInvoiceFromXero(String(r["id"]), null);
    expect(paidEvents().length).toBe(1);
    expect((await rps.repeatPiesaContext(J)).state.stage).toBe("offer");
    expect(offers).toEqual([J]);
  });

  test("Xero: money on the installation invoice never counts as the repeat payment", async () => {
    reopen(KEY1, "owner", 220);
    await rps.acceptRepeatPiesa(J);
    xero.find((i) => i.InvoiceID === "x-inst")!.AmountPaid = 4000;
    await xs.syncInvoiceFromXero(INV, null);
    expect(paidEvents().length).toBe(0);
    expect((await rps.repeatPiesaContext(J)).state.stage).toBe("owner_pay");
  });

  test("card: a card row naming the repeat invoice that covers it → paid once; a card row on another invoice → not", async () => {
    reopen(KEY1, "owner", 220);
    await rps.acceptRepeatPiesa(J);
    const id = String(repeats()[0]!["id"]);
    ev(PAYMENT_EVENT, nextAt(), { invoice_id: INV, amount_cents: 22_000, source: "card", step: "repeat_safety_check" });
    expect(await rps.repeatPaidByCard(J, INV, 371_900)).toBe(false);
    ev(PAYMENT_EVENT, nextAt(), { invoice_id: id, amount_cents: 22_000, source: "card", step: "repeat_safety_check" });
    expect(await rps.repeatPaidByCard(J, id, 22_000)).toBe(true);
    expect(await rps.repeatPaidByCard(J, id, 22_000)).toBe(false);
    expect(paidEvents().length).toBe(1);
    expect(offers).toEqual([J]);
  });

  test("card short of the price → not paid", async () => {
    reopen(KEY1, "owner", 220);
    await rps.acceptRepeatPiesa(J);
    const id = String(repeats()[0]!["id"]);
    ev(PAYMENT_EVENT, nextAt(), { invoice_id: id, amount_cents: 10_000, source: "card", step: "repeat_safety_check" });
    expect(await rps.repeatPaidByCard(J, id, 10_000)).toBe(false);
    expect(paidEvents().length).toBe(0);
  });
});

describe("Xero failure", () => {
  const rows = async () => {
    const hit = (await invoiceFailedFacts([J])).get(J) ?? null;
    return needsCandidates({ jobId: J, jobNumber: "HV-0101", surname: "Smith", suburb: null, invoiceFailed: hit }, Date.now()).filter((r) => r.kind === "invoice_failed");
  };
  test("one invoice_failed row naming the repeat check; Sync retries and clears it", async () => {
    reopen(KEY1, "owner", 220);
    failCreate = true;
    expect((await rps.acceptRepeatPiesa(J)).stage).toBe("owner_pay");
    const r = repeats();
    expect(r.length).toBe(1);
    expect(r[0]!["xero_invoice_id"]).toBeFalsy();
    const failed = tables["workflow_events"]!.filter((e) => e["event_type"] === "invoice_create_failed");
    expect(failed.length).toBe(1);
    expect((failed[0]!["details"] as Record<string, unknown>)["kind"]).toBe("repeat_safety_check");
    const before = await rows();
    expect(before.length).toBe(1);
    expect(before[0]!.line).toBe("Repeat safety check invoice didn't reach Xero · owner can't pay yet");
    failCreate = false;
    await xs.syncInvoiceFromXero(String(r[0]!["id"]), null);
    expect(repeats()[0]!["xero_reference"]).toBe("Home Insulation Victoria HV-0101 safety check 2");
    expect(repeats()[0]!["xero_invoice_id"]).toBeTruthy();
    expect(await rows()).toEqual([]);
    expect(repeats().length).toBe(1);
  });

  test("office Create invoice retries a missing repeat invoice push (twice → still one)", async () => {
    reopen(KEY1, "owner", 220);
    failCreate = true;
    await rps.acceptRepeatPiesa(J);
    failCreate = false;
    await createInvoiceForJob(J, "admin-1");
    await createInvoiceForJob(J, "admin-1");
    expect(repeats().length).toBe(1);
    expect(repeats()[0]!["xero_invoice_id"]).toBeTruthy();
    expect(creates().filter((p) => p.body.Invoices[0].Reference.endsWith("safety check 2")).length).toBe(2); // the failed try + the retry
  });
});

describe("the one-invoice line path is gone", () => {
  test("no repeat line step, no repairs amendment module", () => {
    const src = readFileSync("src/lib/xero.server.ts", "utf8");
    expect(src).not.toMatch(/repeatPiesaStep|addRepeatPiesaToXeroInvoice|xero-repairs/);
    expect(readFileSync("src/lib/repeat-piesa.core.ts", "utf8")).not.toMatch(/repeatLineDue/);
    expect(existsSync("src/lib/xero-repairs.core.ts")).toBe(false);
  });
});
