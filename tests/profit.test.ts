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

describe("job markup breakdown", () => {
  const base = { installerCostExGst: 2500, installerMarginExGst: 300, apFeeExGst: 317, electricalCostExGst: 250, electricalChargeExGst: 349, installerSourced: true, veecDiscountIncGst: 1400 };
  test("installer charged = cost + markup + AP fee", () => {
    const m = jobMargin(base, 90);
    expect(m.installerChargedEx).toBe(3117);
    expect(m.installerMarkup).toBe(300);
    expect(m.electricalMarkup).toBe(99);
    expect(m.referralFeeEx).toBeCloseTo(200);
    expect(m.veecs).toBe(20);
    expect(m.veecMargin).toBe(400);
    expect(m.profit).toBeCloseTo(300 + 317 + 99 + 400 - 200);
  });
  test("HI VIC-sourced job pays no referral fee", () => {
    const m = jobMargin({ ...base, installerSourced: false }, 90);
    expect(m.referralFeeEx).toBe(0);
    expect(m.profit).toBeCloseTo(300 + 317 + 99 + 400);
  });
  test("no spot price = no profit guess", () => {
    const m = jobMargin(base, null);
    expect(m.veecMargin).toBeNull();
    expect(m.profit).toBeNull();
    expect(m.tradeMargin).toBeCloseTo(300 + 317 + 99 - 200);
  });
  test("zero electrical work shows no sparky line", () => {
    const m = jobMargin({ ...base, electricalCostExGst: 0, electricalChargeExGst: 0 }, 90);
    expect(m.electricalMarkup).toBe(0);
  });
});
