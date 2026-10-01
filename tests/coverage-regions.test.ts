import { describe, expect, test } from "bun:test";
import { groupAreasByRegion, regionForPostcode } from "../src/lib/coverage-regions.core";

describe("coverage regions", () => {
  test("maps postcodes to regions", () => {
    expect(regionForPostcode("3000")).toBe("mel_inner");
    expect(regionForPostcode("3029")).toBe("mel_west");
    expect(regionForPostcode("3220")).toBe("geelong");
    expect(regionForPostcode("3550")).toBe("bendigo_macedon");
    expect(regionForPostcode("3840")).toBe("gippsland");
    expect(regionForPostcode(null)).toBe("unknown");
    expect(regionForPostcode("2600")).toBe("unknown");
  });
  test("groups areas and unions teams", () => {
    const t = { id: "a", name: "Spark" };
    const regions = groupAreasByRegion([
      { suburb: "Geelong", postcode: "3220", enquiryCount: 2, overall: "serviceable", rec: { matches: [t] }, installer: { matches: [t] } },
      { suburb: "Belmont", postcode: "3216", enquiryCount: 1, overall: "unserviceable", rec: { matches: [t] }, installer: { matches: [] } },
    ]);
    const g = regions.find((r) => r.id === "geelong")!;
    expect(g.enquiryCount).toBe(3);
    expect(g.recTeams.length).toBe(1);
    expect(g.state).toBe("partial");
    expect(regions.find((r) => r.id === "gippsland")!.state).toBe("empty");
  });
});

import { regionsForDeclaredAreas } from "../src/lib/coverage-regions.core";
test("partner enquiry area labels map to regions", () => {
  expect(regionsForDeclaredAreas(["Melbourne — east", "Melbourne — south-east"]).sort()).toEqual(["mel_east", "mel_south_east"]);
  expect(regionsForDeclaredAreas(["Western Victoria"]).sort()).toEqual(["south_west", "wimmera_mallee"]);
  expect(regionsForDeclaredAreas(["30 Dash Crescent, Fadden ACT 100 km radius"])).toEqual([]);
});
