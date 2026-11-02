// Jo 3 Nov 2026: the one electrician question after a Mitti pickup — own electricians only, no HIV option,
// usual electrician when there is no answer, otherwise hold with an office row. Nothing is sent.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  MITTI_ELECTRICIAN_OFFICE_LINE, mittiElectricianFallback, mittiElectricianPlanProblem, mittiElectricianQuestionOpen,
} from "../src/lib/mitti-electrician.core";

const base = { source: "installer_mitti", electricianChoice: null, hasNomination: false, hasElectricianAssigned: false, hasPiesaOffer: false };

describe("question open", () => {
  test("a Mitti pickup with nothing chosen is asked", () => expect(mittiElectricianQuestionOpen(base)).toBe(true));
  test("an Add a job / website / TEST job is never asked", () => {
    for (const source of ["portal", "base44", "qa_test", null]) expect(mittiElectricianQuestionOpen({ ...base, source })).toBe(false);
  });
  test("closes once anything is chosen, nominated, offered, assigned or the usual electrician was used", () => {
    expect(mittiElectricianQuestionOpen({ ...base, electricianChoice: "preferred" })).toBe(false);
    expect(mittiElectricianQuestionOpen({ ...base, hasNomination: true })).toBe(false);
    expect(mittiElectricianQuestionOpen({ ...base, hasPiesaOffer: true })).toBe(false);
    expect(mittiElectricianQuestionOpen({ ...base, hasElectricianAssigned: true })).toBe(false);
    expect(mittiElectricianQuestionOpen({ ...base, usualUsed: true })).toBe(false);
  });
});

describe("answers: own electricians only", () => {
  test("approved or already-invited electrician accepted", () => {
    expect(mittiElectricianPlanProblem({ mode: "mine", business_id: "b" })).toBeNull();
    expect(mittiElectricianPlanProblem({ mode: "mine", nomination_id: "n" })).toBeNull();
  });
  test("Home Insulation Victoria / later / nothing picked are refused", () => {
    expect(mittiElectricianPlanProblem({ mode: "hivic" })).toBe("Choose one of your own electricians.");
    expect(mittiElectricianPlanProblem({ mode: "later" } as never)).toBe("Choose one of your own electricians.");
    expect(mittiElectricianPlanProblem({ mode: "mine" })).toBe("Choose one of your own electricians.");
    expect(mittiElectricianPlanProblem(null)).toBe("Choose one of your own electricians.");
  });
});

describe("no answer by safety-check time", () => {
  test("approved usual electrician is used", () => expect(mittiElectricianFallback({ questionOpen: true, usualApprovedBusinessId: "orlando" })).toEqual({ action: "use_usual", businessId: "orlando" }));
  test("no approved usual electrician → hold", () => expect(mittiElectricianFallback({ questionOpen: true, usualApprovedBusinessId: null })).toEqual({ action: "hold" }));
  test("an answered job proceeds unchanged", () => expect(mittiElectricianFallback({ questionOpen: false, usualApprovedBusinessId: "orlando" })).toEqual({ action: "proceed" }));
  test("office row wording", () => expect(MITTI_ELECTRICIAN_OFFICE_LINE).toBe("Installer to choose electrician"));
});

describe("wiring", () => {
  const server = readFileSync("src/lib/mitti-electrician.server.ts", "utf8");
  const card = readFileSync("src/components/trade/mitti-electrician-card.tsx", "utf8");
  test("the answer is check-and-set, scoped to the installer's own business, saved the Add a job way", () => {
    expect(server).toContain('.is("electrician_choice", null)');
    expect(server).toContain('from("business_members")');
    expect(server).toContain("recordJobElectricianChoice(jobId, biz, plan, userId)");
  });
  test("the card has no Home Insulation Victoria option and sends no invite", () => {
    expect(card).toContain("<ElectricianPicker ownOnly");
    expect(card).not.toMatch(/onAdd=|addBulkElectrician|hivic/);
  });
  test("auto-offer holds or uses the usual electrician for Mitti pickups", () => {
    const ao = readFileSync("src/lib/auto-offer.server.ts", "utf8");
    expect(ao).toContain("mittiElectricianAtSafetyCheck(jobId)");
    expect(ao).toContain('reason: "installer_to_choose_electrician"');
  });
  test("nothing in the question path sends", () => {
    for (const src of [server, card]) expect(src).not.toMatch(/sendSms|sendEmail|send-email|partner-sender/i);
  });
  test("installer home and office Needs me show it", () => {
    expect(readFileSync("src/lib/trade-view.server.ts", "utf8")).toContain("openMittiElectricianQuestions");
    expect(readFileSync("src/lib/office-needs.server.ts", "utf8")).toContain("mitti_electrician_choice_needed");
  });
});
