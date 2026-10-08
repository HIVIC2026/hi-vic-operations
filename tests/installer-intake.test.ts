import { describe, expect, test } from "bun:test";
import { coordinationNextAction, coordinationProblems, installDayBlockers, installerQuoteReadiness, installerQuoteReleaseBlockers, insulationQualifies, intakeProblems, multiCustomerAmbiguity, prefillFromExtracted, readyCheckOutstanding, rebateEvidenceBlockers } from "../src/lib/installer-intake.core";
import { piesaRequestBlockers } from "../src/lib/payment-gate.core";

const base = { area: "120", amount: "3450", includes: "R5.0 batts supply and install", proposedR: "R5", insulation: "none" as const, quoteFileCount: 0, evidenceAck: true };
const ready = { channel: "installer_sourced", officeEligibility: "eligible" as const, insulation: "none" as const, areaM2: 120, installerQuoteIncGst: 3450 };

describe("installer intake", () => {
  test("none and below R2 qualify; unknown and R2.0 exactly never", () => {
    expect(insulationQualifies("none")).toBe(true);
    expect(insulationQualifies("below_r2")).toBe(true);
    expect(insulationQualifies("unknown")).toBe(false);
    expect(insulationQualifies("below_r2", 2)).toBe(false);
    expect(insulationQualifies("none", 2.5)).toBe(false);
  });
  test("unknown insulation may submit but holds the quote", () => {
    expect(intakeProblems({ ...base, insulation: "unknown" })).toEqual([]);
    expect(installerQuoteReadiness({ ...ready, insulation: "unknown" }).ready).toBe(false);
  });
  test("measured R2.0 blocks the quote", () => {
    expect(installerQuoteReadiness({ ...ready, measuredR: 2 }).blockers).toContain("Existing insulation is R2.0 or more — not eligible");
  });
  test("quote upload OR manual amount + inclusions", () => {
    expect(intakeProblems({ ...base, amount: "", includes: "", quoteFileCount: 1 })).toEqual([]);
    expect(intakeProblems({ ...base, amount: "", includes: "" })).toContain("Upload your quote or enter the quote amount inc GST");
    expect(intakeProblems({ ...base, includes: "" })).toContain("Tell us what the quote includes");
  });
  test("evidence acknowledgment required, no owner-agreed price needed", () => {
    expect(intakeProblems({ ...base, evidenceAck: false })).toEqual(["Tick that all required evidence must be supplied and accepted before the rebate"]);
  });
  test("owner eligibility unresolved or declined blocks the quote", () => {
    expect(installerQuoteReadiness({ ...ready, officeEligibility: "unresolved" }).ready).toBe(false);
    expect(installerQuoteReadiness({ ...ready, officeEligibility: "declined" }).blockers).toContain("Office found the owner or property not eligible");
    expect(installerQuoteReadiness(ready)).toEqual({ ready: true, blockers: [] });
  });
  test("HIV leads never use this route", () => {
    expect(installerQuoteReadiness({ ...ready, channel: "hivic_sourced" }).ready).toBe(false);
  });
  test("release needs a granted consent row and fee awareness", () => {
    expect(installerQuoteReleaseBlockers({ consentStatus: null, feeAwarenessRecorded: true })).toHaveLength(1);
    expect(installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: false })).toHaveLength(1);
    expect(installerQuoteReleaseBlockers({ consentStatus: "granted", feeAwarenessRecorded: true })).toEqual([]);
  });
  test("multi-customer upload is rejected", () => {
    // Ordinary single-customer quote: contractor email + customer email is NOT ambiguous.
    expect(multiCustomerAmbiguity("Cozy Insulation sales@cozy.com.au\nCustomer: Jane Smith\njane@example.com\nSite address: 1 Main St Ballarat 3350")).toBe(false);
    expect(multiCustomerAmbiguity("Customer: Jane Smith\nCustomer: Bob Lee")).toBe(true);
    expect(multiCustomerAmbiguity("Site address: 1 Main St\nSite address: 9 High St")).toBe(true);
    expect(multiCustomerAmbiguity("name,email,address\nJane,jane@x.com,1 Main\nBob,bob@y.com,9 High")).toBe(true);
  });
  test("prefill takes only found values; several price lines stay blank", () => {
    const p = prefillFromExtracted({ measured_area_m2: { value: 120, confidence: "found" }, r_value: { value: 5, confidence: "uncertain" }, quote_lines: [{ description: "Batts", amount: 3000 }, { description: "Removal", amount: 400 }] });
    expect(p.area).toBe("120"); expect(p.proposedR).toBe(""); expect(p.amount).toBe("");
  });
  test("acknowledged/uploaded is not verified evidence; rejected/missing block rebate", () => {
    const items = [{ category: "before_ceiling_space", label: "Before video", blocking: true, status: "uploaded" as const }, { category: "x", label: "Depth photo", blocking: true, status: "rejected" as const }, { category: "y", label: "ID photo", blocking: true, status: "outstanding" as const }];
    const b = rebateEvidenceBlockers({ items, apApprovedBy: "office" });
    expect(b).toEqual(["Before video: uploaded, not yet verified", "Depth photo: rejected — re-upload needed", "ID photo: missing"]);
    expect(readyCheckOutstanding(items).count).toBe(3);
    expect(rebateEvidenceBlockers({ items: items.map((i) => ({ ...i, status: "verified" as const })), apApprovedBy: null })).toEqual(["Final Accredited Person approval not given"]);
    expect(rebateEvidenceBlockers({ items: [], apApprovedBy: "office" })).toHaveLength(1);
  });
  test("install-day order: initial condition before removal; prestart before PIISA", () => {
    expect(installDayBlockers({ initialConditionCaptured: false, prestartComplete: true }, "removal_or_cover")).toHaveLength(1);
    expect(installDayBlockers({ initialConditionCaptured: true, prestartComplete: false }, "piisa_or_works")).toEqual(["Answer the pre-start questions first"]);
  });
  test("PIESA: intake route defers Ready Check but keeps quote approval and payment", () => {
    const pay = { cleared: false, blocker: "Safety check payment not received." } as never;
    expect(piesaRequestBlockers({ readyCheckComplete: false, verifiedEligible: false, currentQuoteApproved: false, payment: pay, installerIntakeQualified: true })).toEqual(["Owner has not approved the current confirmed insulation quote version.", "Safety check payment not received."]);
    expect(piesaRequestBlockers({ readyCheckComplete: false, verifiedEligible: false, currentQuoteApproved: true, payment: { cleared: true } as never })).toEqual(["Ready Check not complete.", "Verified eligibility has not been recorded as eligible."]);
  });
  test("coordination: required choice; self-managed needs unticked ack; both routes keep gates", () => {
    expect(coordinationProblems(null, false)).toEqual(["Choose who will organise this job"]);
    expect(coordinationProblems("self_managed", false)).toHaveLength(1);
    expect(coordinationProblems("self_managed", true)).toEqual([]);
    expect(coordinationProblems("hivic_managed", false)).toEqual([]);
    expect(coordinationNextAction("self_managed")).toMatch(/installer's recorded bookings/);
    expect(coordinationNextAction("hivic_managed")).toMatch(/normal workflow/);
    // Route never relaxes the rebate gate.
    expect(rebateEvidenceBlockers({ items: [{ category: "x", label: "Before video", blocking: true, status: "uploaded" }], apApprovedBy: "office" })).toHaveLength(1);
  });
});
