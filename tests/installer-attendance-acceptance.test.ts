import { describe, expect, test } from "bun:test";
import { installerReadyCheckAction } from "../src/lib/installer-ready-check.core";
import { installerProgress, requireJobRead, requireReads, type ProgressFacts } from "../src/lib/installer-progress.core";

const rc = { channel: "installer_sourced", quoted: "no" as const, timesRequested: false, openWindows: 0, booked: false };
describe("Ready Check action keeps a real booking visible", () => {
  test("attended + unquoted + confirmed booking -> booked (not none)", () => {
    expect(installerReadyCheckAction({ ...rc, stage: "assessment_booking", attended: "yes", booked: true })).toBe("booked");
    expect(installerReadyCheckAction({ ...rc, stage: "ready_check_scheduled", attended: "yes" })).toBe("booked");
    expect(installerReadyCheckAction({ ...rc, stage: "ready_check_ready_to_schedule", attended: "yes" })).toBe("none");
  });
});

const base: ProgressFacts = { coordination: "hivic_managed", quoted: "no", attended: "yes", eligibility: "unresolved", quoteHeld: [], quoteStatus: "none", quoteDelivery: "none", reconfirmationRequired: false, electricianPayer: "hivic", electricalCleared: false, installationCompleted: false, evidence: [], evidenceApprovedAt: null, veecStatus: null, stage: "eligibility_review" };
describe("early progress branches respect attendance", () => {
  test("attended + unquoted + eligibility unresolved: office checks eligibility, no Ready Check arranged", () => {
    const n = installerProgress(base).next;
    expect(n.who).toBe("Home Insulation Victoria");
    expect(n.text).not.toMatch(/arrange the Ready Check/);
    expect(n.text).toMatch(/no second visit/);
  });
  test("quoted + not attended + current draft: preliminary, onsite Ready Check still required", () => {
    const n = installerProgress({ ...base, quoted: "yes", attended: "no", eligibility: "eligible", quoteStatus: "draft", quoteAmountKnown: true }).next;
    expect(n.text).toMatch(/preliminary/); expect(n.text).toMatch(/onsite Ready Check/);
  });
  test("released current quote still outranks attendance wording", () => {
    expect(installerProgress({ ...base, quoted: "yes", attended: "no", eligibility: "eligible", quoteStatus: "issued", quoteDelivery: "released" }).next).toEqual({ who: "Owner", text: "Review and accept the quote." });
  });
});

describe("failed job reads are never unknown attendance", () => {
  test("error or missing row throws; a real null attendance passes through", () => {
    expect(() => requireJobRead({ data: null, error: { message: "timeout" } })).toThrow(/could not load/);
    expect(() => requireJobRead({ data: null, error: null })).toThrow(/not found/);
    expect(requireJobRead({ data: { installer_site_check: null }, error: null })).toEqual({ installer_site_check: null });
    expect(() => requireReads([{ error: null }, { error: { message: "x" } }])).toThrow();
  });
});
