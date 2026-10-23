import { expect, test } from "bun:test";
import { BUILD_DECADE_VALUES, buildDecadeOverFiveYears } from "../src/lib/build-decade.core";
import { insulationTapRoute, ownerInsulationAnswers } from "../src/lib/insulation-details.core";
test("all six website values have identical five-year mapping in owner answer overlay", () => {
  const expected = ["yes", "yes", "yes", "yes", "no", "unknown"];
  BUILD_DECADE_VALUES.forEach((value, i) => {
    expect(buildDecadeOverFiveYears(value)).toBe(expected[i]);
    const raw = { build_decade: "unknown", property_over_five_years: "unknown" };
    const e = { base44: { raw: { answers: raw } }, owner_insulation_details: { answers: { house_built_period: value } } };
    expect(ownerInsulationAnswers(e)).toMatchObject({ build_decade: value, property_over_five_years: expected[i] });
    expect(raw.build_decade).toBe("unknown");
  });
});
test("last five years is ineligible for every type and thickness, with or without photos", () => {
  for (const insulation_type of ["loose_fill", "batts", "unknown"] as const) for (const insulation_thickness of ["thin", "hand", "thicker", "unknown"] as const) for (const photos of [true, false]) {
    expect(insulationTapRoute({ insulation_type, insulation_thickness, house_built_period: "last_5_years" }, photos)).toBe("ineligible");
  }
});