import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { electricianMargins, installerMargins } from "../src/lib/margins.core";
import { jobProfitBreakdown } from "../src/lib/job-profit.core";

const p = { r5PerM2: 30, removalPerM2: 15, piesa: 349, apFee: 349, gstRate: 0.1 };

describe("margins view", () => {
  test("TEST Alpha: $11.50 ex = $12.65 inc → $17.35/m² markup", () => {
    const [r5, rem] = installerMargins(p, 11.5, 4);
    expect(r5).toMatchObject({ rateInc: 12.65, markupInc: 17.35, negative: false });
    expect(rem).toMatchObject({ rateInc: 4.4, markupInc: 10.6 });
  });
  test("rate above owner price is flagged negative", () => {
    expect(installerMargins(p, 28, null)[0]).toMatchObject({ markupInc: -0.8, negative: true });
    expect(electricianMargins(p, 360)[0]).toMatchObject({ markupInc: -11, negative: true });
  });
  test("missing rate shown as missing, not zero", () => {
    expect(electricianMargins(p, null)[0]).toMatchObject({ missing: true, markupInc: null });
  });
  test("follows the current owner price", () => {
    expect(installerMargins({ ...p, r5PerM2: 32 }, 11.5, null)[0].markupInc).toBe(19.35);
  });
});

describe("prices are settings, not code", () => {
  test("quotes read owner prices from the current settings; no access loading (decision 341)", () => {
    const s = readFileSync("src/lib/quotes.server.ts", "utf8");
    expect(s).toContain("rs.r5_install_inc_gst_per_m2");
    expect(s).not.toMatch(/access_(difficult|moderate|standard)_multiplier|access_loadings|accessMultiplier/);
    expect(readFileSync("src/lib/profit.functions.ts", "utf8")).not.toMatch(/access_loadings|accessMultiplier/);
  });
  test("profit uses the office VEEC buy price", () => {
    const base = { hivJob: true, postcode: "3000", estimateAreaM2: 150, measuredAreaM2: null, removalM2: 0, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, installerR5IncPerM2: 12.65, installerRemovalIncPerM2: null, apFeeInc: 349, piesaCustomerInc: 349, electricianPiesaRateInc: 250, currentVeecPrice: 83, acceptedQuoteMarkupInc: null, acceptedQuoteLegacy: false, lodgedVeecs: 20, saleVeecPrice: 90 };
    expect(jobProfitBreakdown({ ...base, veecBuyPrice: 75 }).actual.veecSpread).toBe(300);
  });
  test("admin only; AP fee change limited to the owner account", () => {
    const s = readFileSync("src/lib/owner-prices.functions.ts", "utf8");
    expect(s.match(/requireAdmin\(context\.supabase\)/g)?.length).toBe(3);
    expect(s).toContain('"ap_management_inc_gst" in changes && !canChangeApFee');
  });
});
