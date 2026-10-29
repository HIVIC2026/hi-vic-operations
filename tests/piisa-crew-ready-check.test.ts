import { describe, expect, test } from "bun:test";
import { crewPrefill, crewSelectionProblems, rcAreasFromRecord, readyCheckPartPrefill, staffFromRecords, strictPresent } from "../src/lib/piisa-a3.core";

// Exact production shape (read-only readback): certification is an OBJECT with declared + verification_id.
const workers = [
  { id: "d22a6ed2-7a47-4bbd-b293-9636c5e74740", full_legal_name: "Dominic Doherty", approval_status: "pending", removed_at: null, trade_role: "installer", licence_expires_on: null,
    certification: { declared: { holds: "held", issuer: "Eec", issue_date: null, certificate_number: "4546" }, verification_id: "f13f7aad-9f80-4af4-9c1f-197b6f4a7d05" } },
  { id: "w-train", full_legal_name: "Trainee", approval_status: "approved", removed_at: null, trade_role: "installer",
    certification: { declared: { holds: "in_training", issuer: null, issue_date: null, certificate_number: null }, verification_id: null } },
  { id: "w-ok", full_legal_name: "Ann Approved", approval_status: "approved", removed_at: null, trade_role: "installer",
    certification: { declared: { holds: "held", certificate_number: "TYPED-ONLY" }, verification_id: "11111111-2222-3333-4444-555555555555" } },
];
const certs = [
  { id: "f13f7aad-9f80-4af4-9c1f-197b6f4a7d05", status: "verified", certificate_number: "4546", issuer: "Eec", worker_id: null },
  { id: "11111111-2222-3333-4444-555555555555", status: "verified", certificate_number: "EEC-900", issuer: "EEC", worker_id: "w-ok" },
];
const levels = [
  { certification_id: "11111111-2222-3333-4444-555555555555", level: "Level 1", expires_on: "2027-01-01", recorded_at: "2026-09-01T00:00:00Z" },
  { certification_id: "11111111-2222-3333-4444-555555555555", level: "Level 2", expires_on: "2028-01-01", recorded_at: "2026-10-01T00:00:00Z" },
];

describe("crew roster from the real certification object", () => {
  const staff = staffFromRecords(workers as never, certs, levels, undefined, "2026-10-24");
  test("verified number comes from the linked certification row, never the typed declared value", () => {
    const ann = staff.find((s) => s.workerId === "w-ok")!;
    expect(ann).toMatchObject({ eec: "EEC-900", eecVerified: true, approved: true, cleared: true, level: "Level 2", expiresOn: "2028-01-01" });
    const dom = staff.find((s) => s.name === "Dominic Doherty")!;
    expect(dom).toMatchObject({ eec: "4546", eecVerified: true, approved: false, cleared: false, level: null, expiresOn: null });
    expect(staff.find((s) => s.workerId === "w-train")).toMatchObject({ eec: null, eecVerified: false, cleared: false });
  });
  test("decision 153: a verified EEC without a recorded level/expiry is not cleared (approval_status is not the gate)", () => {
    expect(crewSelectionProblems({ lead: "d22a6ed2-7a47-4bbd-b293-9636c5e74740", additional: [] }, staff).problems.join()).toContain("level and expiry");
    const withLevel = staffFromRecords(workers as never, certs, [...levels, { certification_id: "f13f7aad-9f80-4af4-9c1f-197b6f4a7d05", level: "full", expires_on: "2027-06-30", recorded_at: "2026-10-20T00:00:00Z" }], undefined, "2026-10-24");
    expect(crewSelectionProblems({ lead: "d22a6ed2-7a47-4bbd-b293-9636c5e74740", additional: [] }, withLevel).problems).toEqual([]);
  });
  test("a typed-in Lead is refused; old saved crews still prefill", () => {
    expect(crewSelectionProblems({ lead: { other: { name: "Zed New", eec: "Z-1" } }, additional: [] }, staff).problems).toEqual(["Choose the Lead from your Team list"]);
    expect(crewSelectionProblems({ lead: "w-ok", additional: [{ other: { name: "Zed New", eec: "Z-1" } }, { other: { name: "zed new", eec: "Q" } }] }, staff).problems.join()).toContain("listed twice");
    expect(crewPrefill({ lead: { other: { name: "Zed New", eec: "Z-1" } }, additional: [] }, staff)).toEqual([{ itemId: "p2.lead", row: 0, value: "Zed New" }, { itemId: "p8.name", row: 0, value: "Zed New" }, { itemId: "p2.leadEec", row: 0, value: "Z-1" }]);
  });
});

describe("Ready Check areas: strict and canonical", () => {
  test("'No' text is false, never true; unknown text is unknown", () => {
    expect(strictPresent("No")).toBe(false); expect(strictPresent("Yes")).toBe(true); expect(strictPresent("maybe")).toBeNull(); expect(strictPresent(null)).toBeNull();
    expect(rcAreasFromRecord({ insulation_present: null, existing_r_value: null, zones: [{ name: "A", insulation_present: "No" }] }, null)[0]!.present).toBe(false);
  });
  test("actual Mitti record (flat raw_snapshot, empty zones) reads the canonical row columns", () => {
    const a = rcAreasFromRecord({ insulation_present: true, existing_r_value: 1.5, removal_required: false, zones: [] }, 4);
    expect(a).toEqual([{ present: true, depthMm: null, rValue: 1.5, downlights: 4, removal: false }]);
    expect(readyCheckPartPrefill(a).values).toEqual({ "p6.present": "Yes", "p6.rValue": "1.5", "p6.treatment": "Topped up", "p5.recessed": "Yes", "p5.count": "4" });
  });
  test("removal/top-up never guessed from absence; empty ceiling gives no R-value or treatment", () => {
    expect(readyCheckPartPrefill(rcAreasFromRecord({ insulation_present: true, existing_r_value: null, removal_required: null, zones: [] }, null)).values["p6.treatment"]).toBeUndefined();
    const none = readyCheckPartPrefill(rcAreasFromRecord({ insulation_present: false, existing_r_value: null, removal_required: null, zones: [] }, 0)).values;
    expect(none).toEqual({ "p6.present": "No", "p5.recessed": "No" });
    expect(readyCheckPartPrefill(rcAreasFromRecord({ insulation_present: null, existing_r_value: null, zones: [{ insulation_present: "Yes", removal_required: true }, { insulation_present: "Yes", removal_required: "No" }] }, null)).values["p6.treatment"]).toBe("Removed, Topped up");
  });
});
