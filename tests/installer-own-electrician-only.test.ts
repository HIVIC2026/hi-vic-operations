import { describe, expect, it } from "bun:test";
import { electricianChoiceOptions, defaultElectricianChoice, electricianChoiceProblem, addJobElectricianProblem } from "../src/lib/electrician-choice.core";
import { ELECTRICIAN_PAYER_CHOICES, planPayerChange } from "../src/lib/installer-intake.core";
import { electricianPlanBlocker, jobElectricianLabel } from "../src/lib/job-electrician.core";
import { mittiElectricianQuestionOpen } from "../src/lib/mitti-electrician.core";
import { installerLedOwnerPrice } from "../src/lib/installer-led.core";

describe("Jo 3 Nov installer jobs use own electricians only", () => {
  it("never offers the HIV payer for installer intake", () => {
    expect(ELECTRICIAN_PAYER_CHOICES.map(x => x.value)).toEqual(["own", "undecided"]);
  });
  it("has no HIV fallback when no usual electrician is saved", () => {
    expect(defaultElectricianChoice(null)).toBeNull();
    expect(electricianChoiceOptions(null)).toEqual([]);
  });
  it("defaults only to a saved usual electrician", () => {
    expect(defaultElectricianChoice({ name: "ORLANDO POWERED" })).toBe("usual");
    expect(electricianChoiceOptions({ name: "ORLANDO POWERED" }).map(x => x.value)).toEqual(["usual"]);
  });
  it("rejects the retired choice even if sent by an old client", () => {
    expect(electricianChoiceProblem("hivic", { name: "ORLANDO POWERED" })).not.toBeNull();
    expect(addJobElectricianProblem("hivic", { name: "ORLANDO POWERED", onboarded: true })).not.toBeNull();
  });
  it("rejects a new HIV payer before any change", () => {
    expect(planPayerChange({ currentPayer: "own", requested: "hivic", electricianAccepted: false }).ok).toBe(false);
  });
  it("still reads legacy payer without silently changing it", () => {
    expect(planPayerChange({ currentPayer: "hivic", requested: undefined, electricianAccepted: false })).toEqual({ ok: true, change: false, nextPayer: "hivic" });
  });
  it("requires own electrician selection", () => {
    expect(electricianPlanBlocker({ mode: "hivic" })).not.toBeNull();
    expect(electricianPlanBlocker({ mode: "mine", business_id: "orlando" })).toBeNull();
  });
  it("old installer HIV default is unanswered; website leads stay unchanged", () => {
    const facts = { source: "bulk_import", electricianChoice: "hivic_organise", hasNomination: false, hasElectricianAssigned: false, hasPiesaOffer: false };
    expect(mittiElectricianQuestionOpen({ ...facts, channel: "installer_sourced" })).toBe(true);
    expect(mittiElectricianQuestionOpen({ ...facts, channel: "hivic_sourced" })).toBe(false);
    expect(mittiElectricianQuestionOpen({ ...facts, channel: "installer_sourced", hasElectricianAssigned: true })).toBe(false);
  });
  it("website-lead arrangement label is unchanged while installer legacy rows ask for their own", () => {
    expect(jobElectricianLabel({ choice: "hivic_organise", installerSourced: false })).toBe("Home Insulation Victoria arranges");
    expect(jobElectricianLabel({ choice: "hivic_organise", installerSourced: true })).toBe("Choose your own electrician");
  });
  it("HV-3193 preview preserves every other price line and uses Reinsulate's approved $350 PIESA", () => {
    const price = { installerQuoteIncGst: 2500, rectificationIncGst: 0, apFeeIncGst: 349, veecDiscountIncGst: 1120 };
    expect(installerLedOwnerPrice({ ...price, piesaIncGst: 349 }).afterDiscount).toBe(2078);
    expect(installerLedOwnerPrice({ ...price, piesaIncGst: 350 }).afterDiscount).toBe(2079);
  });
});