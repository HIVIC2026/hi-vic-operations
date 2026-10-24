import { describe, expect, test } from "bun:test";
import { assertHivicPayload, buildInvoicePayload, findTrackingOption } from "../src/lib/xero.core";
const noTracking = async () => ({ TrackingCategories: [] });
const base = { contactId: "c", jobNumber: "HV-1", dueDate: "2026-10-10", total: 100, items: [{ description: "x", quantity: 1, unit_price_inc_gst: 100, line_total_inc_gst: 100 }], veecIncentive: 0 };
describe("Business Unit tracking", () => {
  test("TEST (Demo Company) invoices go without it", async () => {
    expect(await findTrackingOption(noTracking as never, "test")).toBeNull();
    expect(() => assertHivicPayload(buildInvoicePayload({ ...base, tracking: null }), "test")).not.toThrow();
  });
  test("real invoices still strictly require it", async () => {
    await expect(findTrackingOption(noTracking as never, "live")).rejects.toThrow(/Business Unit/);
    expect(() => assertHivicPayload(buildInvoicePayload({ ...base, tracking: null }), "live")).toThrow(/Business Unit/);
    expect(() => assertHivicPayload(buildInvoicePayload({ ...base, tracking: null }))).toThrow(/Business Unit/);
  });
});
