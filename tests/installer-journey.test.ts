import { describe, expect, test } from "bun:test";
import { evidenceFromRecords, journeyStepFor, readyCheckCoverage } from "../src/lib/installer-led.core";

describe("installer journey", () => {
  test("stage mapping", () => {
    expect(journeyStepFor("new_enquiry")).toBe("eligibility");
    expect(journeyStepFor("ready_check_scheduled")).toBe("measure_up");
    expect(journeyStepFor("assessment_booked")).toBe("piesa");
    expect(journeyStepFor("awaiting_quote_acceptance")).toBe("quote");
    expect(journeyStepFor("installation_booked")).toBe("install");
    expect(journeyStepFor("ready_for_veec")).toBe("veecs");
  });
  test("no measurement = nothing supplied", () => {
    expect(readyCheckCoverage(evidenceFromRecords(null, [], null)).status).toBe("none");
  });
  test("under-insulated area needs depth photo and R-value; R2+ hard fails", () => {
    const e = evidenceFromRecords({ measured_area_m2: 120, supplied_area_m2: null, insulation_present: true, existing_r_value: 2.5, removal_required: false, raw_snapshot: {} }, ["before_ceiling_space"], false);
    const c = readyCheckCoverage(e);
    expect(c.status).toBe("partial");
    expect(c.missing.some((x) => x.includes("depth photo"))).toBe(true);
    expect(c.hardFail.length).toBe(1);
  });
  test("full record is complete", () => {
    const e = evidenceFromRecords({ measured_area_m2: 90, supplied_area_m2: null, insulation_present: false, existing_r_value: null, removal_required: null, raw_snapshot: { installer_id_photo: true, building_class: "1a", floor_plan: true, ic_observation: true, area_name: "House" } }, ["before_ceiling_space"], false);
    expect(readyCheckCoverage(e).status).toBe("complete");
  });
});
