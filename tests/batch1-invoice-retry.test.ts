// Batch 1 task 3: the REAL createInvoiceAfterAcceptance + xero.server run against an in-memory database and a mocked
// Xero gateway (global fetch). Own file: it replaces two modules for the whole process.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const J = "00000000-0000-4000-8000-0000000000j1", Q = "00000000-0000-4000-8000-0000000000q1";
const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: null, error: null }) } }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {}, paymentGateActiveForJob: async () => true,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: new Date().toISOString() }); },
}));
const { createInvoiceAfterAcceptance } = await import("../src/lib/invoice-after-acceptance.server");

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
let creates = 0; let failCreate = false; let existing: Record<string, unknown> | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = new URL(String(input));
  if (!url.href.startsWith("https://connector-gateway.lovable.dev/xero")) throw new Error(`network blocked: ${url.href}`);
  const path = url.pathname.replace(/^\/xero/, ""); const method = init?.method ?? "GET";
  if (path === "/connections") return json([{ tenantId: "t-live", tenantName: "DC Construction Solutions Pty Ltd" }, { tenantId: "t-demo", tenantName: "Demo Company (AU)" }]);
  if (path === "/api.xro/2.0/TrackingCategories") return json({ TrackingCategories: [{ Name: "Projects", Status: "ACTIVE", Options: [{ Name: "Home Insulation Victoria", Status: "ACTIVE", TrackingOptionID: "to-1" }] }] });
  if (path === "/api.xro/2.0/Invoices" && method === "GET") return json({ Invoices: existing ? [existing] : [] });
  if (path === "/api.xro/2.0/Contacts" && method === "GET") return json({ Contacts: [{ ContactID: "c-1", ContactStatus: "ACTIVE" }] });
  if (path === "/api.xro/2.0/Invoices" && method === "POST") {
    if (failCreate) return json({ Message: "Xero is down" }, 500);
    creates++;
    existing = { InvoiceID: "x-1", InvoiceNumber: "INV-1", Reference: "Home Insulation Victoria HV-0101", Status: "AUTHORISED", Contact: { ContactID: "c-1" } };
    return json({ Invoices: [existing] });
  }
  if (path.endsWith("/OnlineInvoice")) return json({ OnlineInvoices: [{ OnlineInvoiceUrl: "https://in.xero.com/abc" }] });
  throw new Error(`unmocked Xero call ${method} ${path}`);
}) as unknown as typeof fetch;
process.env["LOVABLE_API_KEY"] = "test-lovable"; process.env["XERO_API_KEY"] = "test-xero";
afterAll(() => { globalThis.fetch = realFetch; });

beforeEach(() => {
  creates = 0; failCreate = false; existing = null;
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    owners: [{ id: "o1", full_name: "Pat Smith", email: "pat@example.com", xero_contact_id: null }],
    properties: [{ id: "p1", address_line: "1 Test St", suburb: "Testville", state: "VIC", postcode: "3000" }],
    jobs: [{ id: J, job_number: "HV-0101", business_unit: "hivic", source: "website", stage: "awaiting_deposit_payment", owner_id: "o1", property_id: "p1" }],
    quotes: [{ id: Q, job_id: J, kind: "installation", status: "accepted", option_label: "Option A", customer_total_inc_gst: 4000, veec_discount_inc_gst: 0 }],
    quote_items: [{ quote_id: Q, code: "INS", description: "Ceiling insulation", quantity: 1, unit_price_inc_gst: 4000, line_total_inc_gst: 4000, sort: 1 }],
    invoices: [], workflow_events: [], external_sync_logs: [], workflow_settings: [{ id: 1, safety_check_payment_inc_gst: 349 }],
  });
});
const failedEvents = () => tables["workflow_events"]!.filter((e) => e.event_type === "invoice_create_failed");

describe("createInvoiceAfterAcceptance", () => {
  test("Xero error swallowed by the push is NOT success: returns the Xero error and records invoice_create_failed", async () => {
    failCreate = true;
    const r = await createInvoiceAfterAcceptance(Q, J, null);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Xero 500");
    expect(failedEvents().length).toBe(1);
    expect(tables["invoices"]!.length).toBe(1);
    expect(tables["invoices"]![0]!["xero_invoice_id"] ?? null).toBeNull();
  });
  test("retry twice after a failure: one invoice row and one Xero create call; the second retry is a no-op success", async () => {
    failCreate = true;
    await createInvoiceAfterAcceptance(Q, J, null);
    failCreate = false;
    expect(await createInvoiceAfterAcceptance(Q, J, "office-1")).toEqual({ ok: true });
    expect(await createInvoiceAfterAcceptance(Q, J, "office-1")).toEqual({ ok: true });
    expect(tables["invoices"]!.length).toBe(1);
    expect(creates).toBe(1);
    expect(tables["invoices"]![0]!["xero_invoice_id"]).toBe("x-1");
    expect(failedEvents().length).toBe(1);
  });
});
