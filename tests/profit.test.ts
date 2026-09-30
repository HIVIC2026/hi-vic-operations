import { describe, expect, test } from "bun:test";
import { jobProfit, parseVeecSpotFromHtml, sellSignal } from "../src/lib/profit.core";

const today = new Date("2026-09-30T00:00:00Z");
describe("profit", () => {
  test("job profit keeps spot minus the owner's $70 per VEEC", () => {
    const p = jobProfit({ customerTotalIncGst: 1100, veecDiscountIncGst: 1400, tradeCostExGst: 2000 }, 90);
    expect(p.veecs).toBe(20); expect(p.veecRevenue).toBe(1800); expect(p.veecMargin).toBe(400); expect(p.profit).toBeCloseTo(-600);
  });
  test("profit is positive when customer price covers trades", () => {
    const p = jobProfit({ customerTotalIncGst: 3300, veecDiscountIncGst: 1400, tradeCostExGst: 2000 }, 90);
    expect(p.profit).toBeCloseTo(3000 + 400 - 2000);
  });
  test("no spot = no profit guess", () => expect(jobProfit({ customerTotalIncGst: 1, veecDiscountIncGst: 70, tradeCostExGst: 0 }, null).profit).toBeNull());
  test("good to sell", () => expect(sellSignal([{ price: 80, priced_on: "2026-08-01" }, { price: 80, priced_on: "2026-09-01" }, { price: 95, priced_on: "2026-09-29" }], today).good).toBe(true));
  test("too little history", () => expect(sellSignal([{ price: 95, priced_on: "2026-09-29" }], today).good).toBe(false));
});

describe("online spot price parser", () => {
  test("reads the current price from the market update wording", () => {
    const html = `<p>VEECs</p><p>This week the VEEC price softened slightly from $86.50 down to $85.80. Over the past 30 days the Spot price has sat within a range of $83.00 to $87.00.</p>`;
    expect(parseVeecSpotFromHtml(html)).toBe(85.8);
  });
  test("fails closed when the wording changes", () => {
    expect(parseVeecSpotFromHtml("<p>Certificates traded actively this week.</p>")).toBeNull();
    expect(parseVeecSpotFromHtml("<p>VEEC market update coming soon.</p>")).toBeNull();
  });
});
