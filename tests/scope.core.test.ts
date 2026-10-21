// Two-requirement model (measure-up + electrical/PIESA). Pure – no network, no database.
import { describe, expect, test } from "bun:test";
import { deriveScope, planMeasurementUpdate, quoteInputsFromMeasurement, tradeMeasurementView, type MeasurementLike } from "../src/lib/scope.core";
import { MITTI_TEMPLATE_ID, createOrReuseAudit, mittiApi, parseAudit, splitPatch, type MittiCall } from "../src/lib/mitti.core";
import { assertHivicJob } from "../src/lib/xero.core";

const full = { measured_area_m2: 120, insulation_present: true, existing_r_value: 1.5, removal_required: false, access_difficulty: "easy" as const };
const noPiesa = { hasCurrentPiesa: false, piesaExpired: false };
const piesa = { hasCurrentPiesa: true, piesaExpired: false };
const inst = (over: Partial<MeasurementLike> = {}): MeasurementLike => ({ id: "m1", status: "complete", source_role: "installer", ...full, ...over });

describe("visit-scope derivation", () => {
  test("1 nothing done → SPLIT; installer measures and electrician completes PIESA", () => {
    const s = deriveScope({ measurement: null, electrical: noPiesa });
    expect(s.scope).toBe("SPLIT");
    expect(s.electricianTasks).toEqual(["electrical"]);
    expect(s.installerTasks).toEqual(["measure_up"]);
    expect(s.editableMeasureFields).toEqual([]);
  });
  test("1b combined visit completes both → COMPLETE", () => {
    expect(deriveScope({ measurement: { ...inst(), source_role: "electrician" }, electrical: piesa }).scope).toBe("COMPLETE");
  });
  test("2 installer measurement accepted first → ELECTRICAL_ONLY, measurement read-only", () => {
    const s = deriveScope({ measurement: inst(), electrical: noPiesa });
    expect(s.scope).toBe("ELECTRICAL_ONLY");
    expect(s.electricianTasks).toEqual(["electrical"]);
    expect(s.editableMeasureFields).toEqual([]);
  });
  test("3 installer measurement needs review → installer completes evidence; electrician remains PIESA-only", () => {
    const s = deriveScope({ measurement: inst({ status: "needs_review", access_difficulty: null, review_flags: [{ field: "existing_r_value" }] }), electrical: noPiesa });
    expect(s.scope).toBe("ELECTRICAL_PLUS_MEASUREUP_COMPLETION");
    expect(s.electricianTasks).toEqual(["electrical"]);
    expect(s.installerTasks).toEqual(["measure_up"]);
    expect(s.editableMeasureFields).toEqual([]);
    expect(s.nextAction).toMatch(/installer eligibility measure-up review/);
  });
  test("4 PIESA first → MEASURE_UP_ONLY for installer", () => {
    const s = deriveScope({ measurement: null, electrical: piesa });
    expect(s.scope).toBe("MEASURE_UP_ONLY");
    expect(s.installerTasks).toEqual(["measure_up"]);
    expect(s.electricianTasks).toEqual([]);
  });
  test("measure-up assigned to installer, nothing done → SPLIT", () => {
    const s = deriveScope({ measurement: null, electrical: noPiesa, measureUpBy: "installer" });
    expect(s.scope).toBe("SPLIT");
    expect(s.electricianTasks).toEqual(["electrical"]);
    expect(s.installerTasks).toEqual(["measure_up"]);
  });
  test("rejected measurement is ignored; expired PIESA is not current", () => {
    expect(deriveScope({ measurement: inst({ status: "rejected" }), electrical: noPiesa }).scope).toBe("SPLIT");
    const s = deriveScope({ measurement: inst(), electrical: { hasCurrentPiesa: true, piesaExpired: true } });
    expect(s.scope).toBe("ELECTRICAL_ONLY");
    expect(s.electrical.state).toBe("expired");
  });
});

describe("measurement update planning", () => {
  test("5 repeated sync with same audit updates the same draft row, never duplicates", () => {
    const first = planMeasurementUpdate({ scope: "SPLIT", current: null, incoming: { measured_area_m2: 100 }, source: "installer", external: { source: "mitti", id: "a1" } });
    expect(first.action).toBe("create");
    const again = planMeasurementUpdate({ scope: "SPLIT", current: { id: "m9", status: "draft", source_role: "installer", measured_area_m2: 100, external_source: "mitti", external_id: "a1" }, incoming: { measured_area_m2: 101 }, source: "installer" });
    expect(again).toMatchObject({ action: "update", id: "m9" });
    const accepted = planMeasurementUpdate({ scope: "COMPLETE", current: inst({ source_role: "electrician" }), incoming: { measured_area_m2: 90 }, source: "electrician" });
    expect(accepted.action).toBe("skip");
  });
  test("6 electrical-only sync cannot overwrite an accepted installer measurement", () => {
    const p = planMeasurementUpdate({ scope: "ELECTRICAL_ONLY", current: inst(), incoming: { measured_area_m2: 55, access_difficulty: "difficult" }, source: "electrician" });
    expect(p.action).toBe("skip");
  });
  test("7 combined Mitti sync splits PIESA data from measurement data", () => {
    const audit = { audit_id: "a1", template_id: MITTI_TEMPLATE_ID, items: [
      { item_id: "1", label: "Net insulation area (m²) = Gross minus Excluded", responses: { text: "88.5" } },
      { item_id: "2", label: "Existing insulation present", responses: { selected: [{ label: "No" }] } },
      { item_id: "3", label: "PIESA outcome", responses: { selected: [{ label: "No electrical fixes required" }] } },
      { item_id: "4", label: "RCDs present", responses: { selected: [{ label: "Yes" }] } },
    ] };
    const { measure, electrical } = splitPatch(parseAudit(audit).patch);
    expect(measure).toEqual({ measured_area_m2: 88.5, insulation_present: false });
    expect(electrical).toMatchObject({ rcds_present: true });
    expect(electrical.piesa_outcome).toBeUndefined(); // imported B1 no-work stays pending
    expect("measured_area_m2" in electrical).toBe(false);
    const p = planMeasurementUpdate({ scope: "SPLIT", current: null, incoming: measure, source: "electrician", external: { source: "mitti", id: "a1" } });
    expect(p).toMatchObject({ action: "skip", reason: expect.stringContaining("belongs to the installer") });
  });
  test("3b electrician cannot complete installer measure-up fields", () => {
    const p = planMeasurementUpdate({ scope: "ELECTRICAL_PLUS_MEASUREUP_COMPLETION", current: inst({ status: "needs_review", access_difficulty: null }), incoming: { measured_area_m2: 999, access_difficulty: "moderate" }, source: "electrician" });
    expect(p).toMatchObject({ action: "skip", reason: expect.stringContaining("belongs to the installer") });
  });
  test("SPLIT: electrician input never writes the installer's measure-up", () => {
    expect(planMeasurementUpdate({ scope: "SPLIT", current: null, incoming: { measured_area_m2: 10 }, source: "electrician" }).action).toBe("skip");
  });
});

describe("quoting reads the accepted measurement", () => {
  test("8 blocked without accepted measurement", () => {
    expect(() => quoteInputsFromMeasurement(null)).toThrow(/missing/);
    expect(() => quoteInputsFromMeasurement(inst({ status: "needs_review" }))).toThrow(/needs review/);
    expect(() => quoteInputsFromMeasurement(inst({ status: "draft" }))).toThrow(/draft/);
    expect(() => quoteInputsFromMeasurement(inst({ measured_area_m2: 0 }))).toThrow(/no measured/);
  });
  test("9 uses accepted measurement area, not stale assessment area", () => {
    const staleAssessment = { measured_area_m2: 50 };
    const q = quoteInputsFromMeasurement(inst({ measured_area_m2: 132.4, removal_required: true, removal_m2: 20, access_difficulty: "moderate" }));
    expect(q).toEqual({ areaM2: 132.4, removalM2: 20, access: "moderate", measurementId: "m1" });
    expect(q.areaM2).not.toBe(staleAssessment.measured_area_m2);
  });
});

describe("unchanged guards / permissions", () => {
  test("12 business-unit guard still fails closed for measure-up Mitti dispatch and Xero", async () => {
    const call: MittiCall = async () => ({});
    const base = { businessUnit: "dc", stage: "piesa_scheduled", jobNumber: "HV-1", existingAuditId: null, electricianEmail: "i@x.test", assigneeRole: "installer" as const, templateId: "template_measure",
      prefill: { jobNumber: "HV-1", address: "a", ownerName: "o", assessorName: "i" } };
    await expect(createOrReuseAudit(mittiApi(call), base)).rejects.toThrow(/only available for Home Insulation Victoria/);
    await expect(createOrReuseAudit(mittiApi(call), { ...base, businessUnit: "hivic", templateId: "" })).rejects.toThrow(/not configured/);
    expect(() => assertHivicJob({ business_unit: "dc" })).toThrow();
  });
  test("14 trade view of a measurement carries no finance/internal fields", () => {
    const v = tradeMeasurementView({ ...inst(), cost_ex_gst: 1, ap_margin_ex_gst: 2, raw_snapshot: {} } as never);
    expect(Object.keys(v).sort()).toEqual(["access_difficulty", "existing_r_value", "insulation_present", "measured_area_m2", "removal_m2", "removal_required", "source_role", "status"]);
    const s = deriveScope({ measurement: inst(), electrical: piesa });
    expect(JSON.stringify(s)).not.toMatch(/price|margin|cost|fee|xero/i);
  });
});
