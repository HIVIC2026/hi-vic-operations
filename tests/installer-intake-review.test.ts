// Review defects 1–10 (Jo, 8 Oct 2026): pure-rule regressions for the installer intake.
import { describe, expect, test } from "bun:test";
import { CLAIM_STALE_MS, INTAKE_REQUIRED_MEDIA, importClaimDecision, installerQuoteReadiness, intakeConfirmFacts, intakeScopeArea, multiCustomerAmbiguity, prefillFromExtracted, rebateEvidenceBlockers, staleQuoteAction, stripIntakeRValues } from "../src/lib/installer-intake.core";
import { planImportedMeasurement } from "../src/lib/pilot.core";

const cust = { full_name: "Jane Smith", email: "jane@example.com", phone: "0400000000", address_line: "1 Main St", suburb: "Ballarat", postcode: "3350" };

describe("1. proposed product R never becomes existing insulation", () => {
  test("confirm facts carry no r_value / existing_r_value", () => {
    const f = intakeConfirmFacts(cust, 120);
    expect("r_value" in f).toBe(false); expect("existing_r_value" in f).toBe(false);
  });
  test("server strip removes them even if a client sends them; imported measurement has no existing R", () => {
    const f = stripIntakeRValues({ ...intakeConfirmFacts(cust, 120), r_value: 5, existing_r_value: 5 });
    const m = planImportedMeasurement(f as never, "imp-1", {});
    expect(m?.existing_r_value).toBeNull();
    expect(m?.insulation_present).toBeNull();
  });
  test("proposed R5 does not block an otherwise eligible quote", () => {
    const m = planImportedMeasurement(stripIntakeRValues({ ...intakeConfirmFacts(cust, 120), r_value: 5 }) as never, "imp-1", {});
    const r = installerQuoteReadiness({ channel: "installer_sourced", officeEligibility: "eligible", insulation: "none", measuredR: m?.existing_r_value ?? null, areaM2: intakeScopeArea(m).areaM2, installerQuoteIncGst: 3450 });
    expect(r).toEqual({ ready: true, blockers: [] });
  });
  test("prefill proposedR only from an explicit proposed/new label", () => {
    expect(prefillFromExtracted({}, "Batts R5.0 supply and install").proposedR).toBe("");
    expect(prefillFromExtracted({}, "Existing R-value: 1.5").proposedR).toBe("");
    expect(prefillFromExtracted({}, "Proposed product R-value: R5.0").proposedR).toBe("5.0");
  });
});

describe("2. provisional installer area is usable for the owner quote only, labelled provisional", () => {
  test("planImportedMeasurement keeps measured empty; scope reads the supplied figure as provisional", () => {
    const m = planImportedMeasurement(intakeConfirmFacts(cust, 132) as never, "imp-2", { standardApproved: false });
    expect(m?.measured_area_m2).toBeNull(); expect(m?.status).toBe("needs_review");
    expect(intakeScopeArea(m)).toEqual({ areaM2: 132, provenance: "installer_provisional" });
  });
  test("verified beats measured beats provisional; non-provisional supplied is ignored", () => {
    expect(intakeScopeArea({ verified_area_m2: 110, measured_area_m2: 120, supplied_area_m2: 130, provenance: "installer_supplied_provisional" })).toEqual({ areaM2: 110, provenance: "verified" });
    expect(intakeScopeArea({ supplied_area_m2: 130, provenance: "electrician" })).toEqual({ areaM2: null, provenance: null });
  });
});

describe("5. race-safe submission claim", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  test("first claimer wins; parallel tab is busy; status confirmed only for done", () => {
    expect(importClaimDecision({ status: "draft", confirmedBy: null, confirmedAt: null, jobId: null }, "u1", now)).toBe("claim");
    expect(importClaimDecision({ status: "draft", confirmedBy: "u1", confirmedAt: new Date(now - 1000).toISOString(), jobId: null }, "u1", now)).toBe("busy");
    expect(importClaimDecision({ status: "draft", confirmedBy: "u2", confirmedAt: new Date(now - 1000).toISOString(), jobId: null }, "u1", now)).toBe("busy");
  });
  test("partial attempt (job created, not confirmed) resumes for the same user — never a second job", () => {
    expect(importClaimDecision({ status: "draft", confirmedBy: "u1", confirmedAt: new Date(now - 1000).toISOString(), jobId: "j1" }, "u1", now)).toBe("resume");
  });
  test("stale crashed claim can be taken over; confirmed returns the same job", () => {
    expect(importClaimDecision({ status: "draft", confirmedBy: "u2", confirmedAt: new Date(now - CLAIM_STALE_MS).toISOString(), jobId: null }, "u1", now)).toBe("claim");
    expect(importClaimDecision({ status: "confirmed", confirmedBy: "u1", confirmedAt: null, jobId: "j1" }, "u1", now)).toBe("done");
    expect(importClaimDecision({ status: "confirmed", confirmedBy: "u2", confirmedAt: null, jobId: "j1" }, "u1", now)).toBe("refuse");
    expect(importClaimDecision({ status: "discarded", confirmedBy: null, confirmedAt: null, jobId: null }, "u1", now)).toBe("refuse");
  });
});

describe("7. multi-customer detection", () => {
  test("contractor header + customer email is one customer and does not prefill the contractor", () => {
    const t = "Cozy Insulation Pty Ltd\nsales@cozy.com.au 03 9000 0000\nQuote for\nCustomer: Jane Smith\njane@example.com\nSite address: 1 Main St Ballarat";
    expect(multiCustomerAmbiguity(t)).toBe(false);
  });
});

describe("8/9. final gate: real verified media and human AP approval", () => {
  const verified = (c: string) => ({ category: c, label: c, blocking: true, status: "verified" as const });
  test("missing before/R-value media blocks even when every recorded item is verified", () => {
    const b = rebateEvidenceBlockers({ items: [verified("completed_installation")], apApprovedBy: "u-admin", requiredCategories: INTAKE_REQUIRED_MEDIA });
    expect(b).toHaveLength(2);
  });
  test("uploaded-but-unverified R-value photo does not count; declaration alone never counts", () => {
    const b = rebateEvidenceBlockers({ items: [verified("before_ceiling_space"), { category: "existing_insulation_r_value", label: "R", blocking: true, status: "uploaded" }], apApprovedBy: "u-admin", requiredCategories: INTAKE_REQUIRED_MEDIA });
    expect(b.some((x) => /not verified/.test(x))).toBe(true);
  });
  test("no AP person = blocked", () => {
    expect(rebateEvidenceBlockers({ items: INTAKE_REQUIRED_MEDIA.map(verified), apApprovedBy: null, requiredCategories: INTAKE_REQUIRED_MEDIA })).toEqual(["Final Accredited Person approval not given"]);
  });
});

describe("10. stale quotes after a material correction", () => {
  test("draft superseded, issued withdrawn, accepted needs owner reconfirmation (never repriced)", () => {
    expect(staleQuoteAction("draft")).toBe("supersede");
    expect(staleQuoteAction("issued")).toBe("withdraw");
    expect(staleQuoteAction("accepted")).toBe("reconfirm");
    expect(staleQuoteAction("declined")).toBe("keep");
  });
});
