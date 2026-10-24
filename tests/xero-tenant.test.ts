import { describe, expect, test } from "bun:test";
import { pickXeroTenant } from "../src/lib/xero.core";
const real = { tenantId: "34719001-1710-4932-bedb-537d37be9897", tenantName: "Home Insulation Victoria" };
const demo = { tenantId: "d", tenantName: "Demo Company (AU)" };
describe("Xero organisation routing", () => {
  test("TEST jobs only use Demo Company", () => {
    expect(pickXeroTenant([real, demo], "test").tenantId).toBe("d");
    expect(() => pickXeroTenant([real], "test")).toThrow(/Demo Company/);
  });
  test("real jobs use the new Home Insulation Victoria organisation, never Demo", () => {
    expect(pickXeroTenant([demo, real], "live")).toBe(real);
    expect(() => pickXeroTenant([demo], "live")).toThrow(/not connected/);
  });
  test("the former DC Construction Solutions organisation cannot receive real jobs", () => {
    const old = { tenantId: "old", tenantName: "DC Construction Solutions Pty Ltd" };
    expect(pickXeroTenant([old, real], "live").tenantId).toBe("34719001-1710-4932-bedb-537d37be9897");
    expect(() => pickXeroTenant([old], "live")).toThrow(/not connected/);
  });
});
