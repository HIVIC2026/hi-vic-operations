import { describe, expect, test } from "bun:test";
import { assertHivicPayload, buildInvoicePayload, findTrackingOption } from "../src/lib/xero.core";
const noTracking = async () => ({ TrackingCategories: [] });
const base = { contactId: "c", jobNumber: "HV-1", dueDate: "2026-10-10", total: 100, items: [{ description: "x", quantity: 1, unit_price_inc_gst: 100, line_total_inc_gst: 100 }], veecIncentive: 0 };
describe("Projects tracking", () => {
  test("DC Projects → Home Insulation Victoria resolves and guards every invoice line", async () => {
    const call = async () => ({ TrackingCategories: [{ Name: "Projects", Status: "ACTIVE", Options: [{ Name: "Home Insulation Victoria", Status: "ACTIVE", TrackingOptionID: "hiv-project" }] }] });
    const tracking = await findTrackingOption(call, "live");
    expect(tracking).toEqual({ categoryName: "Projects", optionName: "Home Insulation Victoria", optionId: "hiv-project" });
    expect(() => assertHivicPayload(buildInvoicePayload({ ...base, tracking }), "live")).not.toThrow();
    expect(() => assertHivicPayload(buildInvoicePayload({ ...base, tracking: { categoryName: "Projects", optionName: "DC Constructions" } }), "live")).toThrow(/Home Insulation Victoria/);
  });
  test("TEST (Demo Company) invoices go without it", async () => {
    expect(await findTrackingOption(noTracking as never, "test")).toBeNull();
    expect(() => assertHivicPayload(buildInvoicePayload({ ...base, tracking: null }), "test")).not.toThrow();
  });
  test("real invoices still strictly require it", async () => {
    await expect(findTrackingOption(noTracking as never, "live")).rejects.toThrow(/Projects/);
    expect(() => assertHivicPayload(buildInvoicePayload({ ...base, tracking: null }), "live")).toThrow(/Projects/);
    expect(() => assertHivicPayload(buildInvoicePayload({ ...base, tracking: null }))).toThrow(/Projects/);
  });
});
