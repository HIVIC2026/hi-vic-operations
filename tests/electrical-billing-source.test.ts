import { describe, expect, test } from "bun:test";
import { electricalBillingSource } from "../src/lib/installer-led.core";
import { jobProfitBreakdown } from "../src/lib/job-profit.core";

const inst = { channel: "installer_sourced", committedLineOnAcceptedQuote: null, hivPaidAt: null };
describe("electrical billing source", () => {
  test("installer's own electrician → HIV payable (Jo 26 Oct: always billed through us)", () => expect(electricalBillingSource({ ...inst, choice: "installer_own" })).toBe("hivic"));
  test("HIV-arranged electrician → HIV payable", () => expect(electricalBillingSource({ ...inst, choice: "hivic_organise" })).toBe("hivic"));
  test("HIV lead never owner direct, whatever the choice", () => expect(electricalBillingSource({ ...inst, channel: "hivic_sourced", choice: "installer_own" })).toBe("hivic"));
  test("accepted quote with PIESA line stays HIV payable (history kept)", () => expect(electricalBillingSource({ ...inst, choice: "installer_own", committedLineOnAcceptedQuote: true })).toBe("hivic"));
  test("recorded HIV payment is never reinterpreted", () => expect(electricalBillingSource({ ...inst, choice: "installer_own", hivPaidAt: "2026-10-01" })).toBe("hivic"));
  test("accepted quote without PIESA line + own → still HIV payable", () => expect(electricalBillingSource({ ...inst, choice: "installer_own", committedLineOnAcceptedQuote: false })).toBe("hivic"));
});

const base = { hivJob: false, postcode: "3000", estimateAreaM2: 100, measuredAreaM2: null, removalM2: 0, ownerR5IncPerM2: 30, ownerRemovalIncPerM2: 10, installerR5IncPerM2: null, installerRemovalIncPerM2: null, apFeeInc: 349, piesaCustomerInc: 349, electricianPiesaRateInc: null, veecBuyPrice: 30, currentVeecPrice: 83, acceptedQuoteMarkupInc: null, acceptedQuoteLegacy: false, lodgedVeecs: null, saleVeecPrice: null };
describe("office profit", () => {
  test("own electrician: PIESA markup 0, no 'rate to be confirmed'", () => {
    const r = jobProfitBreakdown({ ...base, piesaOwnerDirect: true } as never) as unknown as { forecast: { piesaMarkupInc: number; notes: string[] } };
    const side = (r.forecast ?? Object.values(r)[0]) as { piesaMarkupInc: number; notes: string[] };
    expect(side.piesaMarkupInc).toBe(0);
    expect(side.notes.join(" ")).not.toMatch(/to be confirmed/);
  });
  test("HIV-arranged keeps 349 − agreed rate", () => {
    const r = jobProfitBreakdown({ ...base, electricianPiesaRateInc: 250 } as never) as unknown as Record<string, { piesaMarkupInc: number }>;
    expect(Object.values(r).find((v) => v && typeof v === "object" && "piesaMarkupInc" in v)!.piesaMarkupInc).toBe(99);
  });
});
