import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { jobProfitBreakdown, veecCount } from "../src/lib/job-profit.core";

// 150 m² metro Melbourne (3000) HIV job, TEST Alpha R5 $11.50 ex = $12.65 inc, electrician PIESA rate $250 inc.
const base = {
  hivJob: true, postcode: "3000", estimateAreaM2: 150, measuredAreaM2: null, removalM2: 0,
  ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 15, installerR5IncPerM2: 12.65, installerRemovalIncPerM2: 4.4,
  apFeeInc: 349, piesaCustomerInc: 349, electricianPiesaRateInc: 250, currentVeecPrice: 83,
  acceptedQuoteMarkupInc: null, acceptedQuoteLegacy: false, lodgedVeecs: null, saleVeecPrice: null,
};

describe("per-job profit", () => {
  test("worked example: 150 m² HIV job", () => {
    const v = veecCount(150, "3000")!;
    const { expected: e } = jobProfitBreakdown(base);
    expect(e.areaBasis).toBe("estimate");
    expect(e.veecSpread).toBe(Math.round(v * 13 * 100) / 100);
    expect(e.piesaMarkupInc).toBe(99);
    expect(e.installerMarkupInc).toBe(2602.5);
    expect(e.totalInc).toBe(Math.round((349 + 99 + 2602.5 + v * 13) * 100) / 100);
  });
  test("measured area replaces the estimate after the Ready Check", () => {
    const { expected: e } = jobProfitBreakdown({ ...base, measuredAreaM2: 120 });
    expect(e.areaBasis).toBe("measured"); expect(e.installerMarkupInc).toBe(Math.round((30 - 12.65) * 120 * 100) / 100);
  });
  test("installer-supplied job: no installer markup; PIESA markup and AP fee still count", () => {
    const { expected: e } = jobProfitBreakdown({ ...base, hivJob: false });
    expect(e.installerMarkupInc).toBe(0); expect(e.piesaMarkupInc).toBe(99); expect(e.apFeeInc).toBe(349);
  });
  test("actual uses the real sale price and lodged VEECs", () => {
    const { actual: a } = jobProfitBreakdown({ ...base, lodgedVeecs: 20, saleVeecPrice: 90, acceptedQuoteMarkupInc: 2602.5 });
    expect(a.veecSpread).toBe(400); expect(a.veecPriceBasis).toBe("actual sale");
  });
  test("missing electrician rate is flagged, not guessed", () => {
    const { expected: e } = jobProfitBreakdown({ ...base, electricianPiesaRateInc: null });
    expect(e.piesaMarkupInc).toBeNull(); expect(e.totalInc).toBeNull();
  });
  test("office only: the old Profit card (with its own VEEC price entry) is gone from every page; server fn requires admin", () => {
    const fns = readFileSync("src/lib/profit.functions.ts", "utf8");
    const body = fns.slice(fns.indexOf("export const getJobProfit"));
    expect(body.slice(0, body.indexOf("export const setCurrentVeecPrice"))).toContain("requireAdmin(context.supabase)");
    const users = readdirSync("src/routes", { recursive: true }).filter((f) => String(f).endsWith(".tsx") && readFileSync(`src/routes/${f}`, "utf8").includes("OfficeJobProfitCard"));
    expect(users).toEqual([]);
  });
});
