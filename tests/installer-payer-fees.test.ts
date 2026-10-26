import { describe, expect, it } from "bun:test";
import { FEE_AWARENESS_HIV_REC, FEE_AWARENESS_OWN_REC, INSTALLER_CONTACT_PERMISSION, feeAwarenessText, installerQuoteReleaseBlockers, intakeNextAction, intakeProblems, payerFromChoice } from "../src/lib/installer-intake.core";
import { buildInstallerQuoteDraft, installerLedOwnerPrice, piesaChargeIncGst } from "../src/lib/installer-led.core";

describe("installer Add job — Jo 9 Oct 2026 rules", () => {
  it("exact wording", () => {
    expect(INSTALLER_CONTACT_PERMISSION).toBe("The owner has given permission for Home Insulation Victoria to contact them to check eligibility and discuss this job.");
    expect(FEE_AWARENESS_HIV_REC).toBe("The owner has been advised of the $349 PIESA fee and $349 AP management fee, both including GST.");
    expect(FEE_AWARENESS_OWN_REC).toBe("The owner has been advised of the $349 AP management fee and my electrician's safety check (PIESA) fee, both including GST and both on the Home Insulation Victoria quote.");
    expect(feeAwarenessText("undecided")).toBeNull();
  });
  it("No (not measured/quoted) saves without area, insulation or quote", () => {
    expect(intakeProblems({ area: "", amount: "", includes: "", proposedR: "", insulation: null, quoteFileCount: 0, evidenceAck: true, quoteStatus: "not_quoted", requireMeasured: true })).toEqual([]);
  });
  it("Yes requires measured area, insulation and a quote", () => {
    const p = intakeProblems({ area: "", amount: "", includes: "", proposedR: "", insulation: null, quoteFileCount: 0, evidenceAck: true, quoteStatus: "have_quote", requireMeasured: true });
    expect(p).toContain("Enter the measured ceiling area (m²)");
    expect(p).toContain("Choose the existing insulation");
    expect(p).toContain("Upload your quote or enter the quote amount inc GST");
  });
  it("own electrician (Jo 26 Oct): billed through us — no $0 PIESA; the quote waits for their price", () => {
    expect(piesaChargeIncGst("preferred", 349)).toBeNull();
    const o = installerLedOwnerPrice({ installerQuoteIncGst: 3000, piesaIncGst: null, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 0 });
    expect(o.blockers).toContain("PIESA price not agreed for the chosen electrician.");
    const d = buildInstallerQuoteDraft({ price: { price: { totalIncGst: 3000, included: ["Supply"], otherDescription: null }, issues: [] } as never, measuredM2: 100, wholeVeec: { veecs: 0, raw: 0 }, piesaIncGst: 220, apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 } });
    expect(d.lines.map((l) => l.code)).toEqual(["INSTALLER_PRICE", "PIESA", "AP_FEE"]);
  });
  it("HIV electrician keeps the $349 PIESA line", () => {
    const d = buildInstallerQuoteDraft({ price: { price: { totalIncGst: 3000, included: ["Supply"], otherDescription: null }, issues: [] } as never, measuredM2: 100, wholeVeec: { veecs: 0, raw: 0 }, piesaIncGst: 349, apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 } });
    expect(d.lines.map((l) => l.code)).toEqual(["INSTALLER_PRICE", "PIESA", "AP_FEE"]);
  });
  it("payer from stored choice", () => {
    expect(payerFromChoice("hivic_organise")).toBe("hivic");
    expect(payerFromChoice("preferred")).toBe("own");
    expect(payerFromChoice("nominated")).toBe("own");
    expect(payerFromChoice(null)).toBe("undecided");
  });
  it("owner quote holds: undecided electrician, missing or mismatched fee declaration", () => {
    expect(installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: false, electricianPayer: "own" })).toEqual(["Owner fee awareness not recorded yet"]);
    expect(installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: true, feeAwarenessPayer: "hivic", electricianPayer: "own" }).length).toBe(1);
    expect(installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: true, feeAwarenessPayer: "own", electricianPayer: "own" })).toEqual([]);
    expect(installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: true, feeAwarenessPayer: null, electricianPayer: "hivic" })).toEqual([]); // office record
    expect(installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: true, electricianPayer: "undecided" })[0]).toMatch(/Electrician not decided/);
  });
  it("next action by route x measured/quoted", () => {
    expect(intakeNextAction("hivic_managed", false)).toMatch(/arranges the Ready Check/);
    expect(intakeNextAction("self_managed", false)).toMatch(/measure and quote/);
    expect(intakeNextAction("self_managed", true)).toMatch(/owner quote/);
  });
});
