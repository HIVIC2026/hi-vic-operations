// Jo 5 Nov 2026: the Give email's "owner said" rows — insulation as the owner described it (website + quick taps), the size they gave.
import { describe, expect, test } from "bun:test";
import { ownerInsulationWords, ownerSaidLine, ownerSaidRows } from "../src/lib/owner-said.core";

describe("ownerSaidRows", () => {
  test("website answers: some insulation with detail, size typed", () => {
    const rows = ownerSaidRows({ answers: { insulation: "some", insulation_type: "batts", insulation_thickness: "hand", insulation_coverage: "partial" }, estimatedAreaM2: "119.6" });
    expect(rows).toEqual([["Insulation (owner said)", "Some — batts, about a hand thick, patchy"], ["Ceiling size (owner said)", "About 120 m²"]]);
  });
  test("none / not sure / nothing answered", () => {
    expect(ownerInsulationWords({ answers: { insulation: "none" }, estimatedAreaM2: null })).toBe("None");
    expect(ownerInsulationWords({ answers: { insulation: "unknown" }, estimatedAreaM2: null })).toBe("Not sure");
    expect(ownerSaidRows({ answers: {}, estimatedAreaM2: 0 })).toEqual([["Insulation (owner said)", null], ["Ceiling size (owner said)", null]]);
  });
  test("a quick-tap fill wins over the website blank; the Save-my-spot answer is used when the website said nothing", () => {
    expect(ownerInsulationWords({ answers: { insulation: "" }, declared: { insulation: "none" }, estimatedAreaM2: null })).toBe("None");
    expect(ownerInsulationWords({ answers: {}, savedInsulation: "present", estimatedAreaM2: null })).toBe("Some");
  });
  test("office line keeps its 23 Oct shape", () => {
    expect(ownerSaidLine({ answers: { insulation: "none", top_floor: "yes" }, estimatedAreaM2: 80, occupancy: "owner_occupied" })).toBe("No insulation · about 80 m² · top floor · owner-occupied");
    expect(ownerSaidLine({ answers: {}, estimatedAreaM2: null })).toBeNull();
  });
});
