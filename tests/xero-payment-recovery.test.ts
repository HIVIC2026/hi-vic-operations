// Launch blocker Task 2 (QA 7 Nov): a bank payment synced from Xero always finishes its follow-up steps. If
// afterPaymentsChanged failed on the sync that first recorded the payment, the next sync (ledger unchanged) runs it again.
// Real xero.server sync against an in-memory database and a mocked Xero call; never reaches the network.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";

const JOB = "00000000-0000-4000-8000-00000000a201", INV = "00000000-0000-4000-8000-00000000a202";
const tables: Tables = {};
const savedFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error("Network forbidden in Xero payment tests"); }) as typeof fetch;
afterAll(() => { globalThis.fetch = savedFetch; });

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: null, error: null }) } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => {
    tables["workflow_events"]!.push({ id: `ev-${tables["workflow_events"]!.length + 1}`, job_id: job, actor_id: actor, event_type: type, summary, details: details ?? {}, created_at: new Date().toISOString() });
  },
}));
let newLedgerRows = 0;
let failEffectsOnce = false;
const effects: string[] = [];
mock.module("../src/lib/payments.server", () => ({
  recordXeroPayments: async () => newLedgerRows,
  reconciledInvoicePaidCents: async (_j: string, _i: string, o: { xeroAmountPaid?: number }) => Math.round(Number(o?.xeroAmountPaid ?? 0) * 100),
  flagUnclearPaymentMatches: async () => 0,
  afterPaymentsChanged: async (jobId: string) => {
    if (failEffectsOnce) { failEffectsOnce = false; throw new Error("statement timeout"); }
    effects.push(jobId);
    const job = tables["jobs"]!.find((j) => j["id"] === jobId)!;
    job["stage"] = "piesa_requested";
  },
}));
const { syncInvoiceFromXero } = await import("../src/lib/xero.server");

const xeroInvoice = { InvoiceID: "x-1", InvoiceNumber: "INV-1", Status: "AUTHORISED", AmountPaid: 349, Total: 3000,
  Payments: [{ PaymentID: "xp-1", Amount: 349, Date: "2026-11-06T00:00:00", Reference: "bank transfer" }], OnlineInvoiceUrl: "https://in.xero.com/x" };
const call = (async (path: string) => {
  if (path === "/api.xro/2.0/Invoices/x-1") return { Invoices: [structuredClone(xeroInvoice)] };
  throw new Error(`unmocked Xero call ${path}`);
}) as never;

beforeEach(() => {
  newLedgerRows = 0; failEffectsOnce = false; effects.length = 0;
  tables["jobs"] = [{ id: JOB, job_number: "HV-9201", stage: "quote_accepted", business_unit: "hivic", source: "website" }];
  tables["invoices"] = [{ id: INV, job_id: JOB, kind: "installation", xero_invoice_id: "x-1", xero_invoice_number: "INV-1", xero_reference: "Home Insulation Victoria HV-9201",
    xero_online_url: "https://in.xero.com/x", total_inc_gst: 3000, total_paid: 0, deposit_amount: 349, status: "deposit_due", sync_lock_at: null, xero_update_pending: false }];
  tables["workflow_events"] = [];
  tables["external_sync_logs"] = [];
});

test("xero sync reruns follow-up after an earlier failure", async () => {
  // First sync records the bank payment, then the follow-up fails (logged, sync carries on).
  newLedgerRows = 1; failEffectsOnce = true;
  await syncInvoiceFromXero(INV, null, call);
  expect(effects).toHaveLength(0);
  expect(tables["jobs"]![0]!["stage"]).toBe("quote_accepted");
  // Next sync: the ledger is unchanged, but the job is still before the payment step → the follow-up runs now.
  newLedgerRows = 0;
  await syncInvoiceFromXero(INV, null, call);
  expect(effects).toEqual([JOB]);
  expect(tables["jobs"]![0]!["stage"]).toBe("piesa_requested");
});

test("no money paid and no ledger change: the follow-up is not run", async () => {
  xeroInvoice.AmountPaid = 0; xeroInvoice.Payments = [];
  try {
    await syncInvoiceFromXero(INV, null, call);
    expect(effects).toHaveLength(0);
  } finally {
    xeroInvoice.AmountPaid = 349; xeroInvoice.Payments = [{ PaymentID: "xp-1", Amount: 349, Date: "2026-11-06T00:00:00", Reference: "bank transfer" }];
  }
});
