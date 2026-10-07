import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { pickArea } from "../src/lib/estimate.core";

describe("Uploaded jobs: owner always pays HIV owner prices (Jo 7 Oct)", () => {
  test("installer measure-up is priced before the owner/default area", () => {
    const a = pickArea({ installer: { id: "m1", m2: 120 }, owner: 80 });
    expect(a.source).toBe("installer_measurement"); expect(a.m2).toBe(120);
  });
  test("accepted measurement still wins", () => {
    expect(pickArea({ measurement: { id: "a", m2: 100 }, installer: { id: "m1", m2: 120 } }).source).toBe("accepted_measurement");
  });
  test("bulk confirm never turns the installer's quoted price into an owner quote", () => {
    const src = readFileSync("src/lib/bulk-import.server.ts", "utf8");
    expect(src).not.toContain("INSTALLER_PRICE");
    expect(src).not.toMatch(/from\("quotes"\)\.insert/);
    expect(src).toContain("refreshIndicativeEstimate(job.id, { officePricing: true })");
  });
});
