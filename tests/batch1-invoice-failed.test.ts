// Batch 1 task 3: an invoice that never reached Xero after the owner accepted shows on Needs me, and the office can
// press "Create invoice" (safe to repeat: one invoice row, one Xero create).
import { describe, expect, test } from "bun:test";
import { buildNeedsRows, duplicatesInvoiceFailed, invoiceFailedFact, needsCandidates } from "../src/lib/office-needs.core";
import { cardOf } from "../src/lib/needs-cards.core";

const base = { jobId: "J", jobNumber: "HV-1", surname: "Test", suburb: null };
const ev = (at: string, text = "Xero 500") => ({ at, text });
const inv = (o: Partial<{ xero_invoice_id: string | null; last_synced_at: string | null; created_at: string; last_sync_error: string | null; status: string | null }> = {}) =>
  ({ xero_invoice_id: null, last_synced_at: null, created_at: "2026-10-28T01:00:00Z", last_sync_error: null, status: "invoice_not_created", ...o });

describe("Needs me row", () => {
  test("invoiceFailed facts give one invoice_failed row with the agreed line and an Open job button on Money", () => {
    const rows = buildNeedsRows({ now: Date.parse("2026-10-28T05:00:00Z"), jobs: [{ ...base, invoiceFailed: { at: "2026-10-28T02:00:00Z", text: "Xero 500" } }] });
    const mine = Object.values(rows).flat().filter((r) => r.jobId === "J");
    expect(mine.length).toBe(1);
    expect(mine[0]!.kind).toBe("invoice_failed");
    expect(mine[0]!.group).toBe("today");
    expect(mine[0]!.line).toBe("Invoice didn't reach Xero · owner can't pay yet");
    expect(mine[0]!.button).toEqual({ label: "Open job", to: "job", section: "money" });
    expect(needsCandidates({ ...base, invoiceFailed: { at: "2026-10-28T02:00:00Z", text: "x" } }, Date.now())[0]!.rank).toBe(9);
  });
  test("the row sits in the Payments card", () => {
    expect(cardOf("invoice_failed")).toBe("payments");
  });
  test("no row without the fact", () => {
    expect(needsCandidates({ ...base }, Date.now()).some((c) => c.kind === "invoice_failed")).toBe(false);
  });
});

describe("invoiceFailedFact", () => {
  test("failure with no invoice at all → set, newest failure wins", () => {
    expect(invoiceFailedFact([ev("2026-10-28T02:00:00Z", "old"), ev("2026-10-28T03:00:00Z", "new")], [])).toEqual({ at: "2026-10-28T03:00:00Z", text: "new" });
  });
  test("failure newer than any Xero-linked invoice → set", () => {
    expect(invoiceFailedFact([ev("2026-10-28T05:00:00Z")], [inv({ xero_invoice_id: "x1", last_synced_at: "2026-10-28T02:00:00Z" })])?.at).toBe("2026-10-28T05:00:00Z");
  });
  test("failure older than a Xero-linked invoice (office created it since) → not set", () => {
    expect(invoiceFailedFact([ev("2026-10-28T02:00:00Z")], [inv({ xero_invoice_id: "x1", last_synced_at: "2026-10-28T04:00:00Z" })])).toBeNull();
  });
  test("an unlinked invoice does not clear it", () => {
    expect(invoiceFailedFact([ev("2026-10-28T02:00:00Z")], [inv({ created_at: "2026-10-28T09:00:00Z" })])).not.toBeNull();
  });
  test("a local invoice that shows its own Xero problem still gets the row (it is not linked)", () => {
    expect(invoiceFailedFact([ev("2026-10-28T02:00:00Z")], [inv({ last_sync_error: "Xero 500", status: "xero_sync_error" })])).not.toBeNull();
  });
  test("the generic System Xero row is hidden only when the job has the failed-invoice row", () => {
    expect(duplicatesInvoiceFailed("Xero: Xero 500", { at: "x", text: "y" })).toBe(true);
    expect(duplicatesInvoiceFailed("Xero: Xero 500", null)).toBe(false);
    expect(duplicatesInvoiceFailed("ESC notice failed: x", { at: "x", text: "y" })).toBe(false);
  });
  test("no failure event → null", () => { expect(invoiceFailedFact([], [])).toBeNull(); });
});

