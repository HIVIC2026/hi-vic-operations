import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildDueDateUpdate, dueDateUpdateAllowed, pendingDueDateUpdate } from "../src/lib/xero.core";
import { buildDocumentIndex, type JobSources } from "../src/lib/jobfile.core";

// Final-review fixes (Jo 1 Nov 2026, Xero due date branch).

test("C1: a due date is only sent to an open (AUTHORISED) Xero invoice", () => {
  expect(dueDateUpdateAllowed("AUTHORISED")).toBe(true);
  for (const s of ["PAID", "VOIDED", "DELETED", "DRAFT", "SUBMITTED", undefined, null]) expect(dueDateUpdateAllowed(s)).toBe(false);
});

test("C1: a refused due-date update never stops the payment sync (GET before POST, failure caught)", () => {
  const src = readFileSync("src/lib/xero.server.ts", "utf8");
  const fn = src.slice(src.indexOf("export async function syncInvoiceFromXero"));
  const get = fn.indexOf("const r = await call(`/api.xro/2.0/Invoices/${inv.xero_invoice_id}`)");
  const post = fn.indexOf("pendingDueDateUpdate(inv)");
  expect(get).toBeGreaterThan(0);
  expect(post).toBeGreaterThan(get);
  expect(fn.slice(post, post + 1500)).toContain("xero_due_date_update_failed");
});

test("I1: cancelling an install runs for HIV jobs (business_unit is lowercase 'hivic')", () => {
  const src = readFileSync("src/lib/install-balance.server.ts", "utf8");
  expect(src).not.toContain('!== "HIVIC"');
  expect(src).toContain("HIVIC_BUSINESS_UNIT");
});

test("I2: the job file never carries the Xero online invoice link", () => {
  const empty: JobSources = { documents: [], evidenceFiles: [], piesaRecords: [], piesaDeliveries: [], measurements: [], quotes: [], invoices: [], assignments: [], authorities: [], escNotifications: [], veec: [], propertyFacts: [], declarations: [] };
  const items = buildDocumentIndex({ ...empty, invoices: [{ id: "i1", xero_invoice_number: "INV-1", xero_reference: "Home Insulation Victoria HV-1", xero_online_url: "https://in.xero.com/abc", created_at: "2026-11-01T00:00:00Z" }] });
  const inv = items.find((i) => i.id === "invoices:i1")!;
  expect(inv).toBeTruthy();
  expect(JSON.stringify(inv)).not.toContain("in.xero.com");
});

test("I4: a date coming back (A → B → A) gets a fresh idempotency key each time it is set", () => {
  const base = { id: "i1", kind: "installation", xero_invoice_id: "XI", xero_update_pending: true, balance_due_date: null, deposit_due_date: "2026-11-01" };
  const a = pendingDueDateUpdate({ ...base, updated_at: "2026-11-01T01:00:00Z" })!;
  const b = pendingDueDateUpdate({ ...base, updated_at: "2026-11-05T01:00:00Z" })!;
  expect(a.body).toEqual(b.body);
  expect(a.headers["Idempotency-Key"]).not.toBe(b.headers["Idempotency-Key"]);
  // Same pending change retried: same key.
  expect(pendingDueDateUpdate({ ...base, updated_at: "2026-11-01T01:00:00Z" })!.headers["Idempotency-Key"]).toBe(a.headers["Idempotency-Key"]);
  expect(buildDueDateUpdate("XI", "2026-12-01", "i1").headers["Idempotency-Key"]).toBe("hivic-due-i1-2026-12-01");
});
