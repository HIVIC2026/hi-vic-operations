import { describe, expect, test } from "bun:test";
import { pickXeroTenant } from "../src/lib/xero.core";
const real = { tenantId: "r", tenantName: "DC Construction Solutions Pty Ltd" };
const demo = { tenantId: "d", tenantName: "Demo Company (AU)" };
describe("Xero organisation routing", () => {
  test("TEST jobs only use Demo Company", () => {
    expect(pickXeroTenant([real, demo], "test").tenantId).toBe("d");
    expect(() => pickXeroTenant([real], "test")).toThrow(/Demo Company/);
  });
  test("real jobs blocked while switch off, never Demo", () => {
    expect(() => pickXeroTenant([real, demo], "live")).toThrow(/switched off/);
  });
});
