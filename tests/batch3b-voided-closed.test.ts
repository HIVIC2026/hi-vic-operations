// Batch 3b final fix I1: an old fixes invoice voided/deleted in Xero (stored 'voided', passed through by invoice_status)
// is closed everywhere — never "owing" on the owner card, in "owners owe us" or in the office "Request deposit" todo.
import { describe, expect, test } from "bun:test";
import { invoicesShownTo, ownersOweTotal } from "../src/lib/invoice.lifecycle";
import { buildTodos, type TodoInput } from "../src/lib/todo.core";
import { PAYMENT_LABEL } from "../src/lib/workflow";

const install = { id: "i1", kind: "installation", effective_status: "deposit_due", total_inc_gst: 4000, total_paid: 349 };
const oldFix = { id: "i2", kind: "rectification", effective_status: "voided", total_inc_gst: 550, total_paid: 0 };
const newFix = { id: "i3", kind: "rectification", effective_status: "deposit_due", total_inc_gst: 700, total_paid: 0 };

describe("voided old fixes invoice is closed", () => {
  test("owner card: the voided invoice is not shown; the office still sees it", () => {
    expect(invoicesShownTo([install, oldFix, newFix], false).map((i) => i.id)).toEqual(["i1", "i3"]);
    expect(invoicesShownTo([install, oldFix, newFix], true).map((i) => i.id)).toEqual(["i1", "i2", "i3"]);
  });
  test("owners owe us: nothing counted for the voided invoice", () => {
    expect(ownersOweTotal([install, oldFix, newFix])).toBe(3651 + 700);
  });
  test("office todo: no 'Request deposit' or due-date task for a voided invoice", () => {
    const base: TodoInput = { now: Date.parse("2026-10-29T00:00:00Z"), jobs: [{ id: "j1", job_number: "HV-1", property: null, stage: "rectification_scheduling", eligibility_review_required: false, eligibility_outcome: "likely_eligible" }], acceptedQuoteJobs: new Set(["j1"]), invoices: [], rectOther: [], measureReview: [], reassignments: [], partnerEnquiries: [] };
    const inv = { id: "i2", job_id: "j1", xero_invoice_id: "x", xero_invoice_number: "INV-9", deposit_request_raised_at: null, deposit_amount: 550, deposit_cleared: false, status: "voided", last_sync_error: null, xero_update_pending: true, created_at: "2026-10-20T00:00:00Z" };
    expect(buildTodos({ ...base, invoices: [inv] }).filter((t) => t.key.startsWith("inv-"))).toEqual([]);
    expect(buildTodos({ ...base, invoices: [{ ...inv, status: "deposit_due" }] }).map((t) => t.key)).toContain("inv-dep:i2");
  });
  test("the office badge names it", () => {
    expect(PAYMENT_LABEL["voided"]).toBe("Voided in Xero");
  });
});
