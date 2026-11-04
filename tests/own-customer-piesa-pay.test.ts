// Jo 4 Nov 2026 (two boxes — final; replaces Part 10 Task 10's "owner $349, electrician their rate, we keep the gap" and
// main 6f759d0's "$349 pass-through"): on an installer's own customer the owner's PIESA line = that installer's OWN
// onboarded PIESA rate (their rate card's PIESA line — Deep $349, Rapid $275 inc GST), and that same amount is paid
// through in full to whoever does the PIESA. Home Insulation Victoria keeps NOTHING on that line. No rate set → the quote
// can't be sent (hold), never a default $349. Pay still follows the existing payout gate (Complete Mitti form + evidence;
// electricians never wait for the owner — decision 410). HIV leads unchanged (owner $349, electrician their rate, the gap is ours).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { jobMargin, piesaCostExFor } from "../src/lib/job-margin.core";
import { installerPaysOwnElectricians, IN_HOUSE_PIESA_HOLD_REASON } from "../src/lib/installer-paid-electricians.core";
import { MONEY_WORDS, moneyScreen } from "../src/lib/money-screen.core";
import { buildMittiInstallerQuote } from "../src/lib/mitti-installer-quote.core";
import { ownCustomerRows, PIESA_PRICE_NOT_SET } from "../src/lib/own-customer-price.core";
import { safetyCheckPayoutIncGst, withOwnerSafetyCheckPrice } from "../src/lib/safety-check-price.core";
import { electricianPayState } from "../src/lib/trade-view.core";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";
import type { MittiElectricianResolution } from "../src/lib/usual-electrician.core";

const rec = (rate: number | null): MittiElectricianResolution => ({ ready: true, choice: "usual", priceIncGst: rate, name: "Volt Right Electrical", licence: "REC-99001", source: "approved_rec", reasons: [], needsProfile: false });
const input = { price: { ok: true, issues: [], price: { totalIncGst: 2000, included: ["R5.0 supply and install"], otherDescription: "", agreedWithOwner: false } }, measuredM2: 120, wholeVeec: { veecs: 10, raw: 600 }, caps: { metropolitan: true, minCopay: 200 } };

describe("own customer: the owner pays the installer's PIESA rate and that whole amount is paid through", () => {
  for (const [who, rate] of [["Deep (Reinsulate)", 349], ["Rapid", 275], ["someone dearer", 420]] as const) {
    test(`${who} $${rate}: owner line $${rate}, pay $${rate}, cost ex GST ${(rate / 1.1).toFixed(2)}, nothing kept`, () => {
      // main's own-customer resolution puts the business's rate-card PIESA line on the resolution (Jo 3 Nov 10:30am)
      const resolved = withOwnerSafetyCheckPrice(rec(999), 349, "installer_sourced", rate);
      expect(resolved.priceIncGst).toBe(rate);
      const d = buildMittiInstallerQuote(input, resolved);
      const piesa = d.lines.find((l) => l.code === "PIESA")!;
      expect(piesa.line_total_inc_gst).toBe(rate);
      const ownerRows = ownCustomerRows(d.lines.map((l) => ({ code: l.code, description: l.description, line_total_inc_gst: l.line_total_inc_gst })), 600, d.afterDiscount);
      expect(ownerRows.find((r) => r.key === "piesa")!.amountIncGst).toBe(rate);
      // the pay side: the same business rate-card line → the same inc GST amount; never a different figure
      const pay = installerPaysOwnElectricians({ id: "b", name: who, in_house: false, pays_own_electricians: true, piesaIncGst: rate });
      expect(pay).toEqual({ businessId: "b", name: who, piesaIncGst: rate });
      expect(piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: rate })).toBe(Math.round((rate / 1.1) * 100) / 100);
      // the office margin on that line is zero: owner line in, the same amount out
      const m = jobMargin({ ownerPriceInc: 2349 + rate, installerPayEx: 2000 / 1.1, piesaCostEx: piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: rate })!, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true });
      const base = jobMargin({ ownerPriceInc: 2349, installerPayEx: 2000 / 1.1, piesaCostEx: 0, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true });
      expect(m.margin!).toBeCloseTo(base.margin!, 1); // a cent of GST rounding at most
    });
  }
  test("Money row says the installer's own rate (PIESA pay $275), and the rule never mentions the owner's payment", () => {
    const s = moneyScreen([{ jobId: "j", jobNumber: "HV-1234", owner: "Sarah Brown", what: "piesa", amount: 275, ownCustomer: true, state: { kind: "checking" }, ownerFirst: "Sarah", held: [] }], new Date("2026-11-05T03:00:00Z"));
    const text = JSON.stringify(s.rows);
    expect(text).toContain(`${MONEY_WORDS.piesaPay} $275`);
    expect(text).not.toContain("$349");
    expect(text).toContain(MONEY_WORDS.piesaRule);
    expect(MONEY_WORDS.piesaRule).not.toMatch(/owner|paid in full/i);
  });
  test("no rate card line → the quote holds and the pay is held with the one reason, never $349", () => {
    expect(withOwnerSafetyCheckPrice(rec(999), 349, "installer_sourced", null)).toMatchObject({ ready: false, priceIncGst: null });
    const d = buildMittiInstallerQuote(input, { ...rec(null), ready: false, reasons: [IN_HOUSE_PIESA_HOLD_REASON] });
    expect(d.ready).toBe(false);
    expect(d.blockers).toEqual([IN_HOUSE_PIESA_HOLD_REASON]);
    expect(d.lines.find((l) => l.code === "PIESA")).toBeUndefined();
    const r = installerPaysOwnElectricians({ id: "b", name: "Rapid", in_house: false, pays_own_electricians: true, piesaIncGst: null });
    expect(r).toEqual({ businessId: "b", name: "Rapid", piesaIncGst: null, release_hold_reason: IN_HOUSE_PIESA_HOLD_REASON });
    expect(piesaCostExFor({ ownerDirect: false, paidOutInc: null, offerRateInc: null, rateCardInc: null })).toBeNull();
    expect(jobMargin({ ownerPriceInc: 2698, installerPayEx: 1818.18, piesaCostEx: null, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true }).missing).toContain("Electrician PIESA rate not agreed");
    // the Boss/Office card wording: plain, no pay talk, no figure
    expect(PIESA_PRICE_NOT_SET).toBe("Your PIESA price isn't set yet. Ask the office to add it, then send."); // controller 4 Nov 2026: office-managed rate card
  });
  test("Home Insulation Victoria leads unchanged: owner $349, our payout $275 (or the recorded offer rate) — the gap is ours", () => {
    expect(withOwnerSafetyCheckPrice(rec(275), 349, "hivic_sourced", 275).priceIncGst).toBe(349);
    expect(safetyCheckPayoutIncGst({ channel: "hivic_sourced", ownerPriceIncGst: 349, hivPayoutIncGst: 275 })).toBe(275);
    expect(safetyCheckPayoutIncGst({ channel: "hivic_sourced", offerRateInc: 349, ownerPriceIncGst: 349, hivPayoutIncGst: 275 })).toBe(349);
    const m275 = jobMargin({ ownerPriceInc: 2698, installerPayEx: 2000 / 1.1, piesaCostEx: 275 / 1.1, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true });
    const m349 = jobMargin({ ownerPriceInc: 2698, installerPayEx: 2000 / 1.1, piesaCostEx: 349 / 1.1, fixesCostEx: 0, veecValue: 600, veecIncentive: 600, electricianChosen: true });
    expect(m275.margin! - m349.margin!).toBeCloseTo((349 - 275) / 1.1, 2);
  });
  test("electricians never wait for the owner (decision 410): approved → coming; nothing about the owner's payment", () => {
    expect(electricianPayState({ paidAt: null, approvedAt: "2026-11-10T00:00:00Z" }).kind).toBe("coming");
    expect(electricianPayState({ paidAt: null, approvedAt: null }).kind).toBe("checking");
  });
});

describe("source pins: own-customer PIESA pay = the business's rate card line (the recorded quote line first), never a $349 constant", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  test("trade Money reads electrician_rates / the installer's rate-card PIESA line; office Money pays own customers through safetyCheckPayeesFor; the standard $349 setting is read only for Home Insulation Victoria leads", () => {
    const tv = read("src/lib/trade-view.server.ts");
    expect(tv).toContain('from("electrician_rates").select("rate_inc_gst, effective_from")');
    expect(tv).toContain("payee ? payee.piesaIncGst ?? 0 :"); // J1 (4): no rate = a $0 row held "No PIESA rate set — ask the office"
    expect(tv).not.toMatch(/piesa_assessment_inc_gst|safety_check_payment_inc_gst|OWN_CUSTOMER_PIESA_INC_GST/);
    const om = read("src/lib/office-money.server.ts");
    expect(om).toContain('from("electrician_rates")');
    expect(om).not.toMatch(/OWN_CUSTOMER_PIESA_INC_GST/);
    // `piesa_assessment_inc_gst` is read in exactly one place — standardOwnerPiesa(), the HIV-lead owner line — and own
    // customers are priced from `safetyCheckPayeesFor` (the installer's own line) before that fallback is ever consulted.
    const standardFn = om.slice(om.indexOf("async function standardOwnerPiesa"), om.indexOf("async function acceptedPiesaOfferRates"));
    expect(om.match(/piesa_assessment_inc_gst/g)?.length).toBe(standardFn.match(/piesa_assessment_inc_gst/g)?.length);
    expect(om).toContain("Home Insulation Victoria leads only (own customers use their installer's rate)");
    expect(om).toContain("paidToInstaller ? (paidToInstaller.piesaIncGst ?? 0) / (1 + gstRate)"); // J1 (4): no rate = $0 row, never a failed list
    expect(om).toContain("if (paidToInstaller) for (const v of safetyVisits)");
    expect(om).toContain("{ held: [PIESA_RATE_NOT_SET_ROW] }");
    expect(read("src/lib/trade-view.server.ts")).toContain("[PIESA_RATE_NOT_SET_ROW]");
    const reader = read("src/lib/installer-paid-electricians.server.ts");
    expect(reader).toContain('.ilike("code", "piesa")');
    expect(reader).toContain("Math.round(ex * 1.1 * 100) / 100 : null"); // rate card ex GST × 1.1 (speed step 2B's flattened read)
    expect(reader).not.toMatch(/OWN_CUSTOMER_PIESA_INC_GST|349/);
    expect(reader).toContain("const inc = recorded.get(j.id) ?? b?.piesaIncGst;");
    // the quote side: no fixed PIESA constant anywhere in the own-customer pricing
    for (const f of ["src/lib/own-customer-price.core.ts", "src/lib/mitti-installer-quote.core.ts", "src/lib/installer-quote.server.ts"]) expect(read(f)).not.toMatch(/OWN_CUSTOMER_PIESA_INC_GST/);
    // the installer-facing card never shows Home Insulation Victoria's own PIESA price
    expect(read("src/lib/installer-price.core.ts")).not.toMatch(/\$349 PIESA|the \$349 PIESA/);
    expect(read("src/lib/installer-price-set.server.ts")).toContain('piesaPriceSet: piesaCheck.kind === "set"'); // J1 (2): set / not set / read failed
    expect(read("src/components/trade/InstallerPriceCard.tsx")).toContain("PIESA_PRICE_NOT_SET");
  });
  test("the rule is recorded", () => {
    expect(WORKFLOW_DECISIONS.routes.installer_supplied.ownCustomerFees).toMatchObject({ decided: "2026-11-04", apFeeIncGst: 349, piesaLineWhateverElectricianRate: false });
    expect(WORKFLOW_DECISIONS.routes.installer_supplied.ownCustomerElectricianPay).toMatchObject({ decided: "2026-11-04", differenceKeptBy: "nobody — Home Insulation Victoria keeps nothing on an own-customer PIESA line" });
    expect(WORKFLOW_DECISIONS.routes.installer_supplied.ownCustomerElectricianPay.payGate).toContain("decision 410");
    const doc = read("docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md");
    expect(doc).toContain("OWN-CUSTOMER PIESA LINE AND PAY (Jo 4 Nov 2026, final");
    expect(doc).toContain("Home Insulation Victoria keeps nothing on that line");
    expect(read("docs/JO_DECISIONS_LOG.md")).toContain("Own-customer PIESA line = the installer's own PIESA rate (Jo 4 Nov 2026");
  });
});
