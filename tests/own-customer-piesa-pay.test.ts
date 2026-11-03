// Part 10 Task 10 (Jo 2 Nov 2026, answer 2): on an installer's own customer the owner pays $349 for the PIESA (Task 2);
// the electrician is paid THEIR OWN onboarded rate (never the owner's $349 line); Home Insulation Victoria keeps the
// difference, which is never shown to the installer or the owner. Pay still follows the existing payout gate (Complete
// Mitti form + evidence; electricians never wait for the owner — decision 410). Pins the live rules; HIV leads unchanged.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { jobMargin, piesaCostExFor } from "../src/lib/job-margin.core";
import { installerPaysOwnElectricians, IN_HOUSE_PIESA_HOLD_REASON } from "../src/lib/installer-paid-electricians.core";
import { MONEY_WORDS, moneyScreen } from "../src/lib/money-screen.core";
import { buildMittiInstallerQuote } from "../src/lib/mitti-installer-quote.core";
import { ownCustomerRows } from "../src/lib/own-customer-price.core";
import { electricianPayState } from "../src/lib/trade-view.core";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";
import type { MittiElectricianResolution } from "../src/lib/usual-electrician.core";

const rec = (rate: number): MittiElectricianResolution => ({ ready: true, choice: "usual", priceIncGst: rate, name: "Volt Right Electrical", licence: "REC-99001", source: "approved_rec", reasons: [], needsProfile: false });
const input = { price: { ok: true, issues: [], price: { totalIncGst: 2000, included: ["R5.0 supply and install"], otherDescription: "", agreedWithOwner: false } }, measuredM2: 120, wholeVeec: { veecs: 10, raw: 600 }, caps: { metropolitan: true, minCopay: 200 } };

describe("owner pays $349; the electrician's own rate is what we pay", () => {
  for (const rate of [275, 349, 420]) {
    test(`rate card $${rate}: owner line $349, electrician pay $${rate}, cost ex GST ${(rate / 1.1).toFixed(2)}`, () => {
      const d = buildMittiInstallerQuote(input, rec(rate));
      const piesa = d.lines.find((l) => l.code === "PIESA")!;
      expect(piesa.line_total_inc_gst).toBe(349);
      const ownerRows = ownCustomerRows(d.lines.map((l) => ({ code: l.code, description: l.description, line_total_inc_gst: l.line_total_inc_gst })), 600, d.afterDiscount);
      expect(ownerRows.find((r) => r.key === "piesa")!.amountIncGst).toBe(349); // never the rate on an owner row
      if (rate !== 349) expect(ownerRows.map((r) => r.amountIncGst)).not.toContain(rate);
      // the pay side: the rate card line (ex GST) → inc GST pay; never the owner's line
      const pay = installerPaysOwnElectricians({ id: "b", name: "Rapid", in_house: false, pays_own_electricians: true, piesaIncGst: rate });
      expect(pay).toEqual({ businessId: "b", name: "Rapid", piesaIncGst: rate });
      expect(piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: rate })).toBe(Math.round((rate / 1.1) * 100) / 100);
    });
  }
  test("Money row says the electrician's rate (PIESA pay $275), and the rule never mentions the owner's payment", () => {
    const s = moneyScreen([{ jobId: "j", jobNumber: "HV-1234", owner: "Sarah Brown", what: "piesa", amount: 275, ownCustomer: true, state: { kind: "checking" }, ownerFirst: "Sarah", held: [] }], new Date("2026-11-05T03:00:00Z"));
    const text = JSON.stringify(s.rows);
    expect(text).toContain(`${MONEY_WORDS.piesaPay} $275`);
    expect(text).not.toContain("$349");
    expect(text).toContain(MONEY_WORDS.piesaRule);
    expect(MONEY_WORDS.piesaRule).not.toMatch(/owner|paid in full/i);
  });
  test("no rate card line → held with the one reason, never $349", () => {
    const r = installerPaysOwnElectricians({ id: "b", name: "Rapid", in_house: false, pays_own_electricians: true, piesaIncGst: null });
    expect(r).toEqual({ businessId: "b", name: "Rapid", piesaIncGst: null, release_hold_reason: IN_HOUSE_PIESA_HOLD_REASON });
    expect(piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: null })).toBeNull();
    expect(jobMargin({ ownerPriceInc: 2698, installerPayEx: 1818.18, piesaCostEx: null, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true }).missing).toContain("Electrician PIESA rate not agreed");
  });
  test("Home Insulation Victoria keeps the difference (the office margin counts $349 in and the electrician's cost out; $420 makes it negative, still their rate)", () => {
    // Owner price $2,698 inc (installer $2,000 + fee $349 + PIESA $349), rebate $600 passed through as VEEC incentive.
    const m275 = jobMargin({ ownerPriceInc: 2698, installerPayEx: 2000 / 1.1, piesaCostEx: piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: 275 })!, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true });
    const m349 = jobMargin({ ownerPriceInc: 2698, installerPayEx: 2000 / 1.1, piesaCostEx: piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: 349 })!, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true });
    const m420 = jobMargin({ ownerPriceInc: 2698, installerPayEx: 2000 / 1.1, piesaCostEx: piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: 420 })!, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true });
    expect(m275.margin! - m349.margin!).toBeCloseTo((349 - 275) / 1.1, 2); // the $74 inc GST difference is ours
    expect(m420.margin! - m349.margin!).toBeCloseTo((349 - 420) / 1.1, 2); // negative: still the electrician's own rate
    expect(m349.lines.find((l) => l.key === "piesa")!.amount).toBeCloseTo(-317.27, 2);
  });
  test("electricians never wait for the owner (decision 410): approved → coming; nothing about the owner's payment", () => {
    expect(electricianPayState({ paidAt: null, approvedAt: "2026-11-10T00:00:00Z" }).kind).toBe("coming");
    expect(electricianPayState({ paidAt: null, approvedAt: null }).kind).toBe("checking");
  });
});

describe("source pins: pay amounts come from the electrician's or the installer's rate card, never the owner's $349 line", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  test("trade Money reads electrician_rates / the installer's rate-card PIESA line; office Payouts reads electrician_rates; neither reads the owner's PIESA setting or quote line for pay", () => {
    const tv = read("src/lib/trade-view.server.ts");
    expect(tv).toContain('from("electrician_rates").select("rate_inc_gst, effective_from")');
    expect(tv).toContain("payee ? payee.piesaIncGst :");
    expect(tv).not.toMatch(/piesa_assessment_inc_gst|safety_check_payment_inc_gst|OWN_CUSTOMER_PIESA_INC_GST/);
    const om = read("src/lib/office-money.server.ts");
    expect(om).toContain('from("electrician_rates")');
    expect(om).not.toMatch(/OWN_CUSTOMER_PIESA_INC_GST|piesa_assessment_inc_gst/);
    const reader = read("src/lib/installer-paid-electricians.server.ts");
    expect(reader).toContain('.ilike("code", "piesa")');
    expect(reader).toContain("unit_price_ex_gst) * 110) / 100");
    expect(reader).not.toMatch(/OWN_CUSTOMER_PIESA_INC_GST|349/);
  });
  test("the rule is recorded", () => {
    expect(WORKFLOW_DECISIONS.routes.installer_supplied.ownCustomerFees).toMatchObject({ piesaIncGst: 349, piesaLineWhateverElectricianRate: true });
    expect(WORKFLOW_DECISIONS.routes.installer_supplied.ownCustomerElectricianPay).toEqual({ decided: "2026-11-02", ownerPiesaLineIncGst: 349, electricianPaid: "own onboarded PIESA rate (electrician_rates / the installer's rate card PIESA line)", differenceKeptBy: "Home Insulation Victoria", differenceShownTo: "office only (job margin)", payGate: "unchanged (Complete Mitti form + evidence; electricians never wait for the owner — decision 410)" });
    expect(read("docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md")).toContain("electrician is still paid their onboarded rate");
  });
});
