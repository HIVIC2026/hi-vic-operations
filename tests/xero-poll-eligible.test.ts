// Audit R03: the Xero payment poll fallback must reach a newer unpaid invoice even when 40 older settled invoices sit
// ahead of it. The REAL pollXeroPayments runs against an in-memory database (same query, embedded job filters, paging);
// the per-invoice sync is a spy that stamps last_synced_at like the real sync does.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
import { pickXeroPollBatch, xeroPollEligible } from "../src/lib/xero.core";

const tables: Tables = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: (t: string) => memoryPostgrest(tables).from(t), rpc: async () => ({ data: null, error: null }) } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {}, logEvent: async () => undefined, paymentGateActiveForJob: async () => true }));
const { pollXeroPayments } = await import("../src/lib/xero.server");

const prevEnv = process.env["XERO_PAYMENT_POLL_ENABLED"];
afterAll(() => { if (prevEnv === undefined) delete process.env["XERO_PAYMENT_POLL_ENABLED"]; else process.env["XERO_PAYMENT_POLL_ENABLED"] = prevEnv; });

const at = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * 60_000).toISOString();
let clock = 10_000;
const synced: string[] = [];
const sync = async (id: string) => { synced.push(id); tables["invoices"]!.find((r) => r["id"] === id)!["last_synced_at"] = at(clock++); };

function invoice(n: number, o: { paid?: number; total?: number; balancePaidAt?: string | null; stage?: string; unit?: string; linked?: boolean } = {}) {
  const job = { id: `job-${n}`, business_unit: o.unit ?? "hivic", stage: o.stage ?? "installation_booked" };
  tables["jobs"]!.push(job);
  tables["invoices"]!.push({ id: `inv-${String(n).padStart(3, "0")}`, job_id: job.id, total_inc_gst: o.total ?? 4000, total_paid: o.paid ?? 0, balance_paid_at: o.balancePaidAt ?? null, xero_invoice_id: o.linked === false ? null : `x-${n}`, last_synced_at: at(n) });
}
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["jobs"] = []; tables["invoices"] = [];
  synced.length = 0; clock = 10_000;
  process.env["XERO_PAYMENT_POLL_ENABLED"] = "true";
});

describe("R03 acceptance: settled invoices ahead never starve a newer unpaid one", () => {
  test("40 older settled invoices (balance_paid_at recorded) + an unpaid 41st → the bounded run reaches and refreshes the unpaid one", async () => {
    for (let n = 0; n < 40; n++) invoice(n, { paid: 4000, balancePaidAt: at(n) });
    invoice(40);
    expect(await pollXeroPayments(40, { sync })).toEqual({ enabled: true, checked: 1, failed: 0 });
    expect(synced).toEqual(["inv-040"]);
    // and again on the next tick (the old code checked zero invoices on both polls)
    expect((await pollXeroPayments(40, { sync })).checked).toBe(1);
    expect(synced).toEqual(["inv-040", "inv-040"]);
  });

  test("older rows paid in full WITHOUT balance_paid_at and closed jobs are paged past (small pages) until the unpaid one is found", async () => {
    for (let n = 0; n < 40; n++) invoice(n, { paid: 4000 });          // legacy: fully paid, balance_paid_at never stamped
    for (let n = 40; n < 50; n++) invoice(n, { stage: n % 2 ? "cancelled" : "complete" });
    for (let n = 50; n < 55; n++) invoice(n, { unit: "dc" });        // business-unit barrier: never polled
    invoice(55, { linked: false });                                  // not in Xero yet: never polled
    invoice(56);
    const r = await pollXeroPayments(40, { pageSize: 7, sync });
    expect(r).toEqual({ enabled: true, checked: 1, failed: 0 });
    expect(synced).toEqual(["inv-056"]);
  });

  test("rotation by last sync: with more unpaid invoices than the limit, the next tick takes the ones not refreshed yet", async () => {
    for (let n = 0; n < 40; n++) invoice(n, { paid: 4000, balancePaidAt: at(n) });
    for (let n = 40; n < 45; n++) invoice(n);
    await pollXeroPayments(3, { sync });
    expect(synced).toEqual(["inv-040", "inv-041", "inv-042"]);
    synced.length = 0;
    await pollXeroPayments(3, { sync });
    expect(synced).toEqual(["inv-043", "inv-044", "inv-040"]);
  });

  test("a failing sync is counted and does not stop the others", async () => {
    invoice(1); invoice(2);
    const r = await pollXeroPayments(40, { sync: async (id) => { if (id === "inv-001") throw new Error("Xero 503"); synced.push(id); } });
    expect(r).toEqual({ enabled: true, checked: 2, failed: 1 });
    expect(synced).toEqual(["inv-002"]);
  });

  test("switch off → no reads, no syncs", async () => {
    invoice(1);
    process.env["XERO_PAYMENT_POLL_ENABLED"] = "false";
    expect(await pollXeroPayments(40, { sync })).toEqual({ enabled: false, checked: 0, failed: 0 });
    expect(synced).toEqual([]);
  });
});

describe("pure eligibility (xero.core)", () => {
  test("eligible = not fully paid and job not closed; the limit applies to eligible rows only", () => {
    expect(xeroPollEligible({ id: "a", total_inc_gst: 4000, total_paid: 3999.99, jobs: { stage: "installation_booked" } })).toBe(true);
    expect(xeroPollEligible({ id: "a", total_inc_gst: 4000, total_paid: 4000, jobs: { stage: "installation_booked" } })).toBe(false);
    expect(xeroPollEligible({ id: "a", total_inc_gst: 4000, total_paid: 0, jobs: { stage: "cancelled" } })).toBe(false);
    expect(xeroPollEligible({ id: "a", total_inc_gst: 4000, total_paid: 0, jobs: { stage: "complete" } })).toBe(false);
    const rows = [...Array.from({ length: 40 }, (_, i) => ({ id: `s${i}`, total_inc_gst: 1, total_paid: 1, jobs: null })), { id: "u", total_inc_gst: 1, total_paid: 0, jobs: null }];
    expect(pickXeroPollBatch(rows, 40)).toEqual(["u"]);
    expect(pickXeroPollBatch([{ id: "u", total_inc_gst: 1, total_paid: 0 }, { id: "u", total_inc_gst: 1, total_paid: 0 }, { id: "v", total_inc_gst: 1, total_paid: 0 }], 1)).toEqual(["u"]);
  });
});
