import { describe, expect, test } from "bun:test";
import { jobProfit, sellSignal } from "../src/lib/profit.core";

const today = new Date("2026-09-30T00:00:00Z");
describe("profit", () => {
  test("job profit", () => {
    const p = jobProfit({ customerTotalIncGst: 1100, veecDiscountIncGst: 1400, tradeCostExGst: 2000 }, 90);
    expect(p.veecs).toBe(20); expect(p.veecRevenue).toBe(1800); expect(p.veecMargin).toBe(400); expect(p.profit).toBeCloseTo(800);
  });
  test("no spot = no profit guess", () => expect(jobProfit({ customerTotalIncGst: 1, veecDiscountIncGst: 70, tradeCostExGst: 0 }, null).profit).toBeNull());
  test("good to sell", () => expect(sellSignal([{ price: 80, priced_on: "2026-08-01" }, { price: 80, priced_on: "2026-09-01" }, { price: 95, priced_on: "2026-09-29" }], today).good).toBe(true));
  test("too little history", () => expect(sellSignal([{ price: 95, priced_on: "2026-09-29" }], today).good).toBe(false));
});
