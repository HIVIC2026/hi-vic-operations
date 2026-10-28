// Batch 1 task 3: an invoice that never reached Xero after the owner accepted shows on Needs me, and the office can
// press "Create invoice" (safe to repeat: one invoice row, one Xero create).
import { describe, expect, test } from "bun:test";
import { buildNeedsRows, invoiceFailedFact, needsCandidates } from "../src/lib/office-needs.core";

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
  test("a local invoice already showing a Xero sync problem is not duplicated", () => {
    expect(invoiceFailedFact([ev("2026-10-28T02:00:00Z")], [inv({ last_sync_error: "Xero 500", status: "xero_sync_error" })])).toBeNull();
  });
  test("no failure event → null", () => { expect(invoiceFailedFact([], [])).toBeNull(); });
});

describe("retry twice", () => {
  test("ensureInvoice twice → one invoice row; a second push on a linked invoice makes no Xero call", async () => {
    const { ensureInvoice } = await import("../src/lib/invoice.lifecycle");
    const rows: Record<string, unknown>[] = [];
    const store = {
      find: async (quoteId: string) => (rows.find((r) => r["quote_id"] === quoteId) as never) ?? null,
      insert: async (r: Record<string, unknown>) => { const row = { id: `inv-${rows.length + 1}`, ...r }; rows.push(row); return row as never; },
    };
    const q = { id: "Q", job_id: "J", kind: "installation", status: "accepted", customer_total_inc_gst: 4000 };
    const a = await ensureInvoice(store as never, q, "2026-10-28", 349);
    const b = await ensureInvoice(store as never, q, "2026-10-28", 349);
    expect(rows.length).toBe(1);
    expect([a.created, b.created]).toEqual([true, false]);
  });
});

describe("createInvoiceAfterAcceptance", () => {
  test("a failure is recorded for Needs me and returned; success records nothing; the installer is never re-emailed", async () => {
    const { mock } = await import("bun:test");
    const events: unknown[][] = [];
    let fail = true; let calls = 0;
    mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "inv-1" } }) }) }) }) } }));
    mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {}, logEvent: async (...a: unknown[]) => { events.push(a); } }));
    mock.module("../src/lib/xero.server", () => ({ createInvoiceForQuote: async () => { calls++; if (fail) throw new Error("Xero 500"); return "inv-1"; } }));
    const { createInvoiceAfterAcceptance } = await import("../src/lib/invoice-after-acceptance.server");
    expect(await createInvoiceAfterAcceptance("Q", "J", null)).toEqual({ ok: false, error: "Xero 500" });
    expect(events.length).toBe(1);
    expect(events[0]![2]).toBe("invoice_create_failed");
    fail = false;
    expect(await createInvoiceAfterAcceptance("Q", "J", "U")).toEqual({ ok: true });
    expect(events.length).toBe(1);
    expect(calls).toBe(2);
  });
});
