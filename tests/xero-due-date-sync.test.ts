import { expect, test } from "bun:test";
import { pendingDueDateUpdate, XERO_DUE_DATE_UPDATES_ENABLED } from "../src/lib/xero.core";
import { xeroDueDate } from "../src/lib/invoice.lifecycle";

// Jo 1 Nov 2026: Xero due date = install day, else 30 days after acceptance; the 15-minute Xero check sends it.
const inv = (x: Record<string, unknown> = {}) => ({ id: "i1", kind: "installation", xero_invoice_id: "XI", xero_update_pending: true, balance_due_date: null, deposit_due_date: "2026-11-01", ...x });

test("due-date updates are switched on", () => {
  expect(XERO_DUE_DATE_UPDATES_ENABLED).toBe(true);
});

test("no install day: sends 30 days after acceptance", () => {
  expect(pendingDueDateUpdate(inv())?.body.Invoices[0]).toEqual({ InvoiceID: "XI", DueDate: "2026-12-01" });
});

test("install day booked: sends the install day", () => {
  expect(pendingDueDateUpdate(inv({ balance_due_date: "2026-11-20" }))?.body.Invoices[0]).toEqual({ InvoiceID: "XI", DueDate: "2026-11-20" });
});

test("nothing pending, not in Xero, or no date: no update", () => {
  expect(pendingDueDateUpdate(inv({ xero_update_pending: false }))).toBeNull();
  expect(pendingDueDateUpdate(inv({ xero_invoice_id: null }))).toBeNull();
  expect(pendingDueDateUpdate(inv({ deposit_due_date: null }))).toBeNull();
});

test("electrical upgrades and repeat safety check invoices stay due when raised", () => {
  expect(xeroDueDate({ balance_due_date: null, deposit_due_date: "2026-11-01" }, "rectification")).toBe("2026-11-01");
  expect(xeroDueDate({ balance_due_date: null, deposit_due_date: "2026-11-01" }, "repeat_safety_check")).toBe("2026-11-01");
  expect(xeroDueDate({ balance_due_date: null, deposit_due_date: "2026-11-01" }, "installation")).toBe("2026-12-01");
  expect(pendingDueDateUpdate(inv({ kind: "rectification" }))?.body.Invoices[0]).toEqual({ InvoiceID: "XI", DueDate: "2026-11-01" });
});
