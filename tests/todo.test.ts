import { describe, expect, test } from "bun:test";
import { buildTodos, type TodoInput } from "../src/lib/todo.core";

const base = (): TodoInput => ({
  now: Date.parse("2026-10-01T00:00:00Z"),
  jobs: [{ id: "j1", job_number: "HV-1", property: "1 Test St", stage: "awaiting_deposit_payment", eligibility_review_required: false, eligibility_outcome: "likely_eligible" }], acceptedQuoteJobs: new Set(["j1", "j2"]),
  invoices: [], rectOther: [], measureReview: [], reassignments: [], partnerEnquiries: [],
});
const inv = { id: "i1", job_id: "j1", xero_invoice_id: "x", xero_invoice_number: "INV-9", deposit_request_raised_at: null, deposit_amount: 1000, deposit_cleared: false, status: "deposit_due", last_sync_error: null, xero_update_pending: false, created_at: "2026-09-29T00:00:00Z" };

describe("TO ACTION list", () => {
  test("invoice without deposit request asks staff to request it in Xero", () => {
    const t = buildTodos({ ...base(), invoices: [inv] });
    expect(t.map((x) => x.key)).toEqual(["inv-dep:i1"]);
    expect(t[0]!.action).toContain("INV-9");
    expect(t[0]!.urgent).toBe(true);
  });
  test("clears once the request is recorded", () => {
    expect(buildTodos({ ...base(), invoices: [{ ...inv, deposit_request_raised_at: "2026-09-30T00:00:00Z" }] })).toEqual([]);
  });
  test("sync error replaces deposit task", () => {
    const t = buildTodos({ ...base(), invoices: [{ ...inv, status: "xero_sync_error", last_sync_error: "bad" }] });
    expect(t.map((x) => x.key)).toEqual(["inv-sync:i1"]);
  });
  test("items for inactive jobs are ignored; office stages listed", () => {
    const t = buildTodos({ ...base(), jobs: [{ id: "j2", job_number: "HV-2", property: null, stage: "ap_review", eligibility_review_required: false, eligibility_outcome: "likely_eligible" }], invoices: [inv] });
    expect(t.map((x) => x.key)).toEqual(["stage:ap_review:j2"]);
  });
});
