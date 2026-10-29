// Batch 3b Task 2: electrical fixes get their OWN Xero invoice (reference "Home Insulation Victoria <job> fixes"), never a
// line on the installation invoice. The REAL invoice-after-acceptance + xero.server + office-needs server facts run
// against an in-memory database and a mocked Xero gateway (global fetch). Never reaches the network.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000j1";
const QI = "00000000-0000-4000-8000-0000000000q1", QR = "00000000-0000-4000-8000-0000000000r1", QR2 = "00000000-0000-4000-8000-0000000000r2";
const INV = "00000000-0000-4000-8000-0000000000i1", OLDFIX = "00000000-0000-4000-8000-0000000000i2";
const tables: Tables = {};
let clock = Date.parse("2026-10-29T00:00:00Z");
const nextAt = () => new Date((clock += 1000)).toISOString();
// `enumWithoutVoided`: the live database before the pending SQL runs — writing status 'voided' is refused.
let enumWithoutVoided = false;
const withoutVoided = (q: any) => {
  const update = q.update.bind(q);
  q.update = (v: Record<string, unknown>) => (v["status"] === "voided" ? { eq: async () => ({ data: null, error: { message: 'invalid input value for enum payment_status: "voided"' } }) } : update(v));
  return q;
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => (enumWithoutVoided && t === "invoices" ? withoutVoided(memoryPostgrest(tables).from(t)) : memoryPostgrest(tables).from(t)), rpc: async () => ({ data: null, error: null }) } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  WorkflowError: class extends Error {}, paymentGateActiveForJob: async () => true,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: nextAt() }); },
}));
// Downstream effects of a payment are other modules' business — no-ops here.
mock.module("../src/lib/payments.server", () => ({
  recordXeroPayments: async () => 0, reconciledInvoicePaidCents: async () => 0, flagUnclearPaymentMatches: async () => undefined, afterPaymentsChanged: async () => undefined,
}));

const { createInvoiceAfterAcceptance } = await import("../src/lib/invoice-after-acceptance.server");
const xs = await import("../src/lib/xero.server");
const { buildInvoicePayload, findInvoiceByReference, xeroReference, VEEC_INCENTIVE_LINE } = await import("../src/lib/xero.core");
const { invoiceFailedFacts, oldFixesInvoiceFacts } = await import("../src/lib/office-needs.server");
const { needsCandidates, OLD_FIXES_INVOICE_LINE } = await import("../src/lib/office-needs.core");
const { cardOf } = await import("../src/lib/needs-cards.core");

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
  // Deliberately loose: every invoice comes back, so only the portal's own exact match decides what is adopted.
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

const tracking = { categoryName: "Projects", optionName: "Home Insulation Victoria" };
function installXero(): XInv {
  const p = buildInvoicePayload({ contactId: "c-1", jobNumber: "HV-0101", dueDate: "2026-11-20", total: 4000, kind: "installation", tracking, veecIncentive: 749, items: [
    { description: "Pre Insulation Electrical Safety Assessment (PIESA)", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 },
    { description: "AP fee", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349 },
    { description: "Ceiling insulation — 120 m²", quantity: 1, unit_price_inc_gst: 4051, line_total_inc_gst: 4051 },
  ] }).Invoices[0]!;
  return { InvoiceID: "x-inst", InvoiceNumber: "INV-0101", Reference: p.Reference, Status: "AUTHORISED", Contact: { ContactID: "c-1" }, LineItems: p.LineItems, Total: 4000, AmountPaid: 0, Payments: [] };
}
const fixesItems = (quoteId: string, a: number, b: number) => [
  { quote_id: quoteId, code: "RCD_INSTALL", description: "Install RCD", quantity: 1, unit_price_inc_gst: a, line_total_inc_gst: a, sort: 1 },
  { quote_id: quoteId, code: "DOWNLIGHT_UPGRADE", description: "Downlight upgrade to IC-4 LED", quantity: 2, unit_price_inc_gst: b, line_total_inc_gst: 2 * b, sort: 2 },
];

beforeEach(() => {
  failCreate = false; posts.length = 0; xero = [installXero()];
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    owners: [{ id: "o1", full_name: "Pat Smith", email: "pat@example.com", xero_contact_id: "c-1" }],
    properties: [{ id: "p1", address_line: "1 Test St", suburb: "Testville", state: "VIC", postcode: "3000" }],
    jobs: [{ id: J, job_number: "HV-0101", business_unit: "hivic", source: "website", stage: "rectification_scheduling", owner_id: "o1", property_id: "p1" }],
    quotes: [
      { id: QI, job_id: J, kind: "installation", status: "accepted", option_label: "R5.0 ceiling insulation", customer_total_inc_gst: 4000, veec_discount_inc_gst: 749, accepted_at: "2026-10-20T01:00:00.000Z", created_at: "2026-10-20T00:00:00.000Z" },
      { id: QR, job_id: J, kind: "rectification", status: "accepted", option_label: "Electrical fixes", customer_total_inc_gst: 550, veec_discount_inc_gst: 0, accepted_at: "2026-10-24T01:00:00.000Z", created_at: "2026-10-24T00:00:00.000Z" },
    ],
    quote_items: [
      { quote_id: QI, code: "PIESA", description: "Pre Insulation Electrical Safety Assessment (PIESA)", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349, sort: 1 },
      { quote_id: QI, code: "AP_FEE", description: "AP fee", quantity: 1, unit_price_inc_gst: 349, line_total_inc_gst: 349, sort: 2 },
      { quote_id: QI, code: "R5", description: "Ceiling insulation — 120 m²", quantity: 1, unit_price_inc_gst: 4051, line_total_inc_gst: 4051, sort: 3 },
      ...fixesItems(QR, 250, 150),
    ],
    invoices: [{ id: INV, job_id: J, quote_id: QI, kind: "installation", status: "deposit_due", total_inc_gst: 4000, total_paid: 349, deposit_amount: 349, balance_amount: 3651, deposit_pct: 0.0873,
      deposit_paid_at: "2026-10-20T02:00:00.000Z", balance_paid_at: null, deposit_due_date: "2026-10-20", balance_due_date: null, xero_invoice_id: "x-inst", xero_invoice_number: "INV-0101", xero_reference: "Home Insulation Victoria HV-0101",
      xero_invoice_status: "AUTHORISED", xero_online_url: "https://in.xero.com/abc", xero_update_pending: false, sync_lock_at: null, last_synced_at: "2026-10-24T00:00:00.000Z", last_sync_error: null, created_at: "2026-10-20T01:00:00.000Z" }],
    workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349 }],
    workflow_events: [], external_sync_logs: [],
  });
});
const invoices = (kind: string) => tables["invoices"]!.filter((i) => i["kind"] === kind);
const creates = () => posts.filter((p) => p.path === "/api.xro/2.0/Invoices");

describe("the reference names the invoice", () => {
  test("fixes, installation unchanged, repeat safety checks numbered from 2", () => {
    expect(xeroReference("HV-1234", "rectification")).toBe("Home Insulation Victoria HV-1234 fixes");
    expect(xeroReference("HV-1234", "installation")).toBe("Home Insulation Victoria HV-1234");
    expect(xeroReference("HV-1234", "repeat_safety_check", 2)).toBe("Home Insulation Victoria HV-1234 safety check 2");
    expect(xeroReference("HV-1234", "repeat_safety_check", 3)).toBe("Home Insulation Victoria HV-1234 safety check 3");
  });
  test("a fixes payload has no VEEC incentive line and carries the fixes reference on every line", () => {
    const p = buildInvoicePayload({ contactId: "c", jobNumber: "HV-1234", dueDate: "2026-11-01", total: 550, kind: "rectification", tracking, veecIncentive: 0, items: fixesItems("q", 250, 150) }).Invoices[0]!;
    expect(p.Reference).toBe("Home Insulation Victoria HV-1234 fixes");
    expect(p.LineItems.some((l) => l.Description.includes(VEEC_INCENTIVE_LINE))).toBe(false);
    expect(p.LineItems.every((l) => l.Description.startsWith("Home Insulation Victoria HV-1234 fixes"))).toBe(true);
    expect(sum(p.LineItems)).toBe(550);
  });
});

describe("accepting a fixes quote raises its own invoice", () => {
  test("ONE rectification invoice with only the fixes lines, total = the fixes quote; accepting twice is still one", async () => {
    const installRow = structuredClone(invoices("installation")[0]);
    const installX = structuredClone(xero[0]);
    expect(await createInvoiceAfterAcceptance(QR, J, "owner-1")).toEqual({ ok: true });
    expect(await createInvoiceAfterAcceptance(QR, J, "owner-1")).toEqual({ ok: true });
    const fx = invoices("rectification");
    expect(fx.length).toBe(1);
    expect(fx[0]!["quote_id"]).toBe(QR);
    expect(Number(fx[0]!["total_inc_gst"])).toBe(550);
    expect(fx[0]!["xero_reference"]).toBe("Home Insulation Victoria HV-0101 fixes");
    expect(creates().length).toBe(1);
    const lines = creates()[0]!.body.Invoices[0].LineItems as { Description: string }[];
    expect(lines.length).toBe(2);
    expect(lines.map((l) => l.Description).join("\n")).not.toMatch(/PIESA|Safety Assessment|AP fee|VEEC|Ceiling insulation/i);
    expect(sum(lines)).toBe(550);
    // The installation invoice row and its Xero invoice are untouched.
    expect(invoices("installation")).toEqual([installRow!]);
    expect(xero[0]).toEqual(installX!);
    expect(posts.some((p) => p.path.startsWith("/api.xro/2.0/Invoices/"))).toBe(false);
  });

  test("the install reference never finds the fixes invoice (exact match)", async () => {
    await createInvoiceAfterAcceptance(QR, J, "owner-1");
    const call = (p: string, i?: { method?: string; body?: unknown; headers?: Record<string, string> }) => fetch(`https://connector-gateway.lovable.dev/xero${p}`, { method: i?.method ?? "GET", headers: { "xero-tenant-id": "t-live" } }).then((r) => r.json());
    expect((await findInvoiceByReference(call, "Home Insulation Victoria HV-0101"))?.InvoiceID).toBe("x-inst");
    xero = xero.filter((x) => x.InvoiceID !== "x-inst");
    expect(await findInvoiceByReference(call, "Home Insulation Victoria HV-0101")).toBeNull();
    expect((await findInvoiceByReference(call, "Home Insulation Victoria HV-0101 fixes"))?.Reference).toBe("Home Insulation Victoria HV-0101 fixes");
  });

  test("owner approval of fixes goes through the once-only invoice step, never onto the installation invoice", () => {
    const src = readFileSync("src/lib/portal.functions.ts", "utf8");
    const body = src.slice(src.indexOf("export async function respondToQuoteImpl"), src.indexOf("async function invoiceAfterAcceptance"));
    expect(body).not.toContain("addRepairsToXeroInvoice");
    const accepted = body.slice(body.indexOf(`if (q.kind === "rectification") {\n      await logEvent`));
    expect(accepted.slice(0, accepted.indexOf("// Old model"))).toContain("await invoiceAfterAcceptance(q.id, q.job_id, context.userId)");
    expect(readFileSync("src/lib/xero.server.ts", "utf8")).not.toMatch(/addRepairsToXeroInvoice|repairsStep/);
  });
});

describe("superseded fixes", () => {
  function seedOldFixes(over: Record<string, unknown> = {}) {
    tables["quotes"]!.find((q) => q["id"] === QR)!["status"] = "superseded";
    tables["quotes"]!.push({ id: QR2, job_id: J, kind: "rectification", status: "accepted", option_label: "Electrical fixes", customer_total_inc_gst: 700, veec_discount_inc_gst: 0, accepted_at: "2026-10-27T01:00:00.000Z", created_at: "2026-10-27T00:00:00.000Z" });
    tables["quote_items"]!.push(...fixesItems(QR2, 300, 200));
    const old = { InvoiceID: "x-oldfix", InvoiceNumber: "INV-0102", Reference: "Home Insulation Victoria HV-0101 fixes", Status: "AUTHORISED", Contact: { ContactID: "c-1" }, LineItems: [], Total: 550, AmountPaid: 0, Payments: [] };
    xero.push(old);
    tables["invoices"]!.push({ id: OLDFIX, job_id: J, quote_id: QR, kind: "rectification", status: "deposit_due", total_inc_gst: 550, total_paid: 0, deposit_amount: 550, balance_amount: 0, deposit_pct: 1,
      deposit_paid_at: null, balance_paid_at: null, deposit_due_date: "2026-10-24", balance_due_date: null, xero_invoice_id: "x-oldfix", xero_invoice_number: "INV-0102", xero_reference: old.Reference,
      xero_invoice_status: "AUTHORISED", xero_online_url: null, xero_update_pending: false, sync_lock_at: null, last_synced_at: "2026-10-24T02:00:00.000Z", last_sync_error: null, created_at: "2026-10-24T02:00:00.000Z", ...over });
  }
  const rowsFor = async () => {
    const old = (await oldFixesInvoiceFacts([J])).get(J) ?? null;
    return needsCandidates({ jobId: J, jobNumber: "HV-0101", surname: "Smith", suburb: null, oldFixesInvoiceUnpaid: old }, Date.now()).filter((r) => r.kind === "old_fixes_invoice_unpaid");
  };

  test("the newer accepted fixes quote gets its own invoice (the old Xero invoice is never adopted) and the old unpaid one raises ONE Needs me row", async () => {
    seedOldFixes();
    expect(await createInvoiceAfterAcceptance(QR2, J, "owner-1")).toEqual({ ok: true });
    const fx = invoices("rectification");
    expect(fx.length).toBe(2);
    const fresh = fx.find((i) => i["quote_id"] === QR2)!;
    expect(fresh["xero_invoice_id"]).not.toBe("x-oldfix");
    expect(Number(fresh["total_inc_gst"])).toBe(700);
    expect(creates().length).toBe(1);
    const rows = await rowsFor();
    expect(rows.length).toBe(1);
    expect(rows[0]!.line).toBe("Old fixes invoice unpaid — void it in Xero");
    expect(OLD_FIXES_INVOICE_LINE).toBe("Old fixes invoice unpaid — void it in Xero");
    expect(rows[0]!.group).toBe("today");
    expect(cardOf("old_fixes_invoice_unpaid")).toBe("payments");
  });

  test("voided in Xero, or already paid → no row", async () => {
    seedOldFixes({ xero_invoice_status: "VOIDED" });
    expect(await rowsFor()).toEqual([]);
    tables["invoices"]!.find((i) => i["id"] === OLDFIX)!["xero_invoice_status"] = "AUTHORISED";
    tables["invoices"]!.find((i) => i["id"] === OLDFIX)!["total_paid"] = 100;
    expect(await rowsFor()).toEqual([]);
  });

  test("office voids the old one in Xero → Sync records it as finished: no sync error, no problem row, Needs me row gone", async () => {
    seedOldFixes();
    await createInvoiceAfterAcceptance(QR2, J, "owner-1");
    expect((await rowsFor()).length).toBe(1);
    xero.find((x) => x.InvoiceID === "x-oldfix")!.Status = "VOIDED";
    await xs.syncInvoiceFromXero(OLDFIX, "office-1");
    const old = tables["invoices"]!.find((i) => i["id"] === OLDFIX)!;
    expect(old["status"]).not.toBe("xero_sync_error");
    // Final fix I1: stored as 'voided' so invoice_status (pending SQL) never shows it owing / overdue.
    expect(old["status"]).toBe("voided");
    expect(old["last_sync_error"] ?? null).toBeNull();
    expect(old["xero_invoice_status"]).toBe("VOIDED");
    // office.server "Xero problems" read: last_sync_error set or status xero_sync_error → none on this job.
    expect(tables["invoices"]!.filter((i) => i["job_id"] === J && (i["last_sync_error"] != null || i["status"] === "xero_sync_error"))).toEqual([]);
    expect(await rowsFor()).toEqual([]);
    expect((await invoiceFailedFacts([J])).size).toBe(0);
    // A second Sync logs nothing new.
    const n = tables["workflow_events"]!.length;
    await xs.syncInvoiceFromXero(OLDFIX, "office-1");
    expect(tables["workflow_events"]!.length).toBe(n);
  });

  test("I1: before the pending SQL runs ('voided' not allowed yet) Sync still records the void as before", async () => {
    seedOldFixes();
    await createInvoiceAfterAcceptance(QR2, J, "owner-1");
    xero.find((x) => x.InvoiceID === "x-oldfix")!.Status = "DELETED";
    enumWithoutVoided = true;
    try { await xs.syncInvoiceFromXero(OLDFIX, "office-1"); } finally { enumWithoutVoided = false; }
    const old = tables["invoices"]!.find((i) => i["id"] === OLDFIX)!;
    expect(old["status"]).toBe("deposit_due");
    expect(old["xero_invoice_status"]).toBe("DELETED");
    expect(old["last_sync_error"] ?? null).toBeNull();
    expect(await rowsFor()).toEqual([]);
  });

  test("the CURRENT fixes invoice voided in Xero is still a sync problem (unchanged)", async () => {
    await createInvoiceAfterAcceptance(QR, J, "owner-1");
    const fx = invoices("rectification")[0]!;
    xero.find((x) => x.InvoiceID === fx["xero_invoice_id"])!.Status = "VOIDED";
    await xs.syncInvoiceFromXero(String(fx["id"]), "office-1");
    expect(invoices("rectification")[0]!["status"]).toBe("xero_sync_error");
  });

  test("the current accepted fixes invoice is never flagged", async () => {
    await createInvoiceAfterAcceptance(QR, J, "owner-1");
    expect(await rowsFor()).toEqual([]);
  });
});

describe("Xero failure on the fixes invoice", () => {
  const rowsFor = async () => {
    const fail = (await invoiceFailedFacts([J])).get(J) ?? null;
    return needsCandidates({ jobId: J, jobNumber: "HV-0101", surname: "Smith", suburb: null, invoiceFailed: fail }, Date.now()).filter((r) => r.kind === "invoice_failed");
  };
  test("one invoice_failed row naming the fixes; Sync retries the push and clears it", async () => {
    failCreate = true;
    const r = await createInvoiceAfterAcceptance(QR, J, "owner-1");
    expect(r.ok).toBe(false);
    let rows = await rowsFor();
    expect(rows.length).toBe(1);
    expect(rows[0]!.line).toMatch(/fixes/i);
    expect(rows[0]!.line).toBe("Fixes invoice didn't reach Xero · owner can't pay yet");
    const fx = invoices("rectification");
    expect(fx.length).toBe(1);
    expect(fx[0]!["xero_invoice_id"] ?? null).toBeNull();
    failCreate = false;
    await xs.syncInvoiceFromXero(String(fx[0]!["id"]), "office-1");
    expect(invoices("rectification")[0]!["xero_invoice_id"]).toBeTruthy();
    expect(invoices("rectification")[0]!["xero_reference"]).toBe("Home Insulation Victoria HV-0101 fixes");
    rows = await rowsFor();
    expect(rows).toEqual([]);
  });
  test("office Create invoice also creates a missing fixes invoice (no local row after the failure), once only", async () => {
    const { createInvoiceForJob } = await import("../src/lib/office-money.server");
    const installRow = structuredClone(invoices("installation")[0]);
    expect(invoices("rectification").length).toBe(0);
    expect(await createInvoiceForJob(J, "office-1")).toEqual({ ok: true });
    expect(await createInvoiceForJob(J, "office-1")).toEqual({ ok: true });
    const fx = invoices("rectification");
    expect(fx.length).toBe(1);
    expect(fx[0]!["quote_id"]).toBe(QR);
    expect(fx[0]!["xero_reference"]).toBe("Home Insulation Victoria HV-0101 fixes");
    expect(creates().length).toBe(1);
    expect(invoices("installation")).toEqual([installRow!]);
  });
  test("an installation invoice failure keeps its wording", async () => {
    tables["invoices"] = []; xero = []; // nothing in Xero to adopt
    failCreate = true;
    await createInvoiceAfterAcceptance(QI, J, "owner-1").catch(() => null);
    const rows = await rowsFor();
    expect(rows.length).toBe(1);
    expect(rows[0]!.line).toBe("Invoice didn't reach Xero · owner can't pay yet");
  });
});
