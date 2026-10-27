import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { offerMoney } from "../src/lib/trade-view.core";

// Jo 27 Oct 2026 (decision 412): on job offers only the business owner sees money (electrician pay, installer $/m²).
describe("Offer money is for the business owner only", () => {
  const s = { electrician_rate_inc_gst: 220, installer_rate_per_m2: 30 };
  test("business owner sees pay and rate", () => { expect(offerMoney(true, s)).toEqual({ pay: 220, ratePerM2: 30 }); });
  test("worker sees no pay or rate", () => { expect(offerMoney(false, s)).toEqual({ pay: null, ratePerM2: null }); });
  test("missing figures stay null for the owner", () => { expect(offerMoney(true, {})).toEqual({ pay: null, ratePerM2: null }); });
  test("the offer screen uses the rule, not the raw summary", () => {
    const src = readFileSync("src/lib/trade-view.server.ts", "utf8");
    expect(src).toContain("offerMoney(c.boss, s)");
    expect(src).not.toMatch(/pay: s\.electrician_rate_inc_gst/);
    expect(src).not.toMatch(/ratePerM2: s\.installer_rate_per_m2/);
    expect(src).toContain("piesaDays, boss: c.boss,");
    const ui = readFileSync("src/routes/_authenticated/field.offer.$offerId.tsx", "utf8");
    expect(ui).toContain("{data.boss && <p className=\"-mt-1.5");
  });
});
