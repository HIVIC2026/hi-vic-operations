import { describe, expect, test } from "bun:test";
import { pickXeroTenant } from "../src/lib/xero.core";
const real = { tenantId: "dc", tenantName: "DC Construction Solutions Pty Ltd" };
const demo = { tenantId: "d", tenantName: "Demo Company (AU)" };
describe("Xero organisation routing", () => {
  test("TEST jobs only use Demo Company", () => {
    expect(pickXeroTenant([real, demo], "test").tenantId).toBe("d");
    expect(() => pickXeroTenant([real], "test")).toThrow(/Demo Company/);
  });
  test("real jobs use DC Construction Solutions, never Demo", () => {
    expect(pickXeroTenant([demo, real], "live")).toBe(real);
    expect(() => pickXeroTenant([demo], "live")).toThrow(/not connected/);
  });
  test("the separate Home Insulation Victoria organisation is no longer selected", () => {
    const old = { tenantId: "old", tenantName: "Home Insulation Victoria" };
    expect(pickXeroTenant([old, real], "live").tenantId).toBe("dc");
    expect(() => pickXeroTenant([old], "live")).toThrow(/not connected/);
  });
});
