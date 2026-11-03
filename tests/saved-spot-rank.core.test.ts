import { describe, expect, it } from "bun:test";
import {
  BAND_ORDER,
  estimatedCeiling,
  insulationDetailFromDesk,
  spotBand,
  spotReason,
  spotScore,
  spotTags,
  type SpotFacts,
} from "../src/lib/saved-spot-rank.core";

const NOW = Date.parse("2026-11-03T00:00:00Z");
const base: SpotFacts = {
  insulation: "present",
  insulationDetail: "thicker",
  deskCheck: null,
  aiPhoto: null,
  propertyType: "house",
  topFloor: null,
  areaM2: null,
  roofGroundM2: null,
  footprintM2: null,
  listingFloorM2: null,
  roofForm: null,
  complexRoof: false,
  tapsHatch: null,
  tapsRoof: null,
  listing: null,
  lifeSupport: false,
  streetKnown: true,
  spotSavedAt: "2026-11-01T00:00:00Z",
};
const f = (o: Partial<SpotFacts> = {}): SpotFacts => ({ ...base, ...o });
const score = (o: Partial<SpotFacts> = {}) => spotScore(f(o), NOW);
const listing = (o: Partial<NonNullable<SpotFacts["listing"]>> = {}) => ({
  found: true,
  floorPlan: false,
  type: null,
  storeys: null,
  checked: true,
  ...o,
});

describe("bands", () => {
  it("BAND_ORDER is best to weak", () =>
    expect(BAND_ORDER).toEqual(["best", "good", "ok", "weak"]));
  it("desk looks_eligible is best", () =>
    expect(spotBand(f({ deskCheck: "looks_eligible" }))).toBe("best"));
  it("AI under_r2 with desk pending is best, tagged AI: confirm", () => {
    const x = f({ aiPhoto: "under_r2", deskCheck: "pending" });
    expect(spotBand(x)).toBe("best");
    expect(spotTags(x)).toContain("AI: confirm");
  });
  it("AI none is best, tagged AI: confirm", () => {
    const x = f({ aiPhoto: "none" });
    expect(spotBand(x)).toBe("best");
    expect(spotTags(x)).toContain("AI: confirm");
  });
  it("desk looks_eligible beats AI over_r2, no AI tag", () => {
    const x = f({ deskCheck: "looks_eligible", aiPhoto: "over_r2" });
    expect(spotBand(x)).toBe("best");
    expect(spotTags(x).some((t) => t.startsWith("AI:"))).toBe(false);
  });
  it("AI over_r2 with no desk check is weak, tagged", () => {
    const x = f({ aiPhoto: "over_r2", insulation: "none", insulationDetail: null });
    expect(spotBand(x)).toBe("weak");
    expect(spotTags(x)).toContain("AI: looks over R2 — confirm");
  });
  it("AI cant_tell takes the band from the answers", () => {
    expect(spotBand(f({ aiPhoto: "cant_tell", insulation: "none", insulationDetail: null }))).toBe(
      "good",
    );
    expect(spotTags(f({ aiPhoto: "cant_tell" })).some((t) => t.startsWith("AI:"))).toBe(false);
  });
  it("insulation none is good", () =>
    expect(spotBand(f({ insulation: "none", insulationDetail: null }))).toBe("good"));
  it("present + under_r2 / thin / loose_fill / patchy is ok", () => {
    for (const d of ["under_r2", "thin", "loose_fill", "patchy"] as const)
      expect(spotBand(f({ insulationDetail: d }))).toBe("ok");
  });
  it("unknown is ok", () =>
    expect(spotBand(f({ insulation: "unknown", insulationDetail: null }))).toBe("ok"));
  it("present + null detail is weak", () =>
    expect(spotBand(f({ insulationDetail: null }))).toBe("weak"));
  it("present + thicker is weak", () =>
    expect(spotBand(f({ insulationDetail: "thicker" }))).toBe("weak"));
  it("no insulation answer is weak", () =>
    expect(spotBand(f({ insulation: null, insulationDetail: null }))).toBe("weak"));
  it("apartment not on top floor is weak even with no insulation", () => {
    expect(
      spotBand(
        f({
          propertyType: "apartment",
          topFloor: "no",
          insulation: "none",
          insulationDetail: null,
        }),
      ),
    ).toBe("weak");
  });
  it("apartment not on top floor still best when desk looks_eligible or AI under/none", () => {
    const a = { propertyType: "apartment", topFloor: "no" } as const;
    expect(spotBand(f({ ...a, deskCheck: "looks_eligible" }))).toBe("best");
    expect(spotBand(f({ ...a, aiPhoto: "under_r2" }))).toBe("best");
  });
  it("apartment on top floor follows the answers", () => {
    expect(
      spotBand(
        f({
          propertyType: "apartment",
          topFloor: "yes",
          insulation: "none",
          insulationDetail: null,
        }),
      ),
    ).toBe("good");
  });
});

describe("score", () => {
  it("house > townhouse > apartment", () => {
    expect(score({ propertyType: "house" })).toBeGreaterThan(score({ propertyType: "townhouse" }));
    expect(score({ propertyType: "townhouse" })).toBeGreaterThan(
      score({ propertyType: "apartment" }),
    );
  });
  it("bigger ceiling scores higher", () =>
    expect(score({ areaM2: 200 })).toBeGreaterThan(score({ areaM2: 100 })));
  it("floor plan beats none", () => {
    expect(score({ listing: listing({ floorPlan: true }) })).toBeGreaterThan(
      score({ listing: null }),
    );
  });
  it("pitched > unknown > flat roof", () => {
    expect(score({ roofForm: "pitched" })).toBeGreaterThan(score({ roofForm: null }));
    expect(score({ roofForm: null })).toBeGreaterThan(score({ roofForm: "low_slope_flat" }));
  });
  it("quick taps: hatch yes + sloped roof up; roof flat below not_sure", () => {
    expect(score({ tapsHatch: "yes", tapsRoof: "sloped" })).toBeGreaterThan(score());
    expect(score({ tapsRoof: "flat" })).toBeLessThan(score({ tapsRoof: "not_sure" }));
  });
  it("listing storeys 2 scores lower than null", () => {
    expect(score({ listing: listing({ storeys: 2 }) })).toBeLessThan(
      score({ listing: listing({ storeys: null }) }),
    );
  });
  it("complex roof is a small step down", () => {
    const d = score() - score({ complexRoof: true });
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(5);
  });
  it("older saved date scores higher (tie-break)", () => {
    expect(score({ spotSavedAt: "2026-10-01T00:00:00Z" })).toBeGreaterThan(
      score({ spotSavedAt: "2026-11-02T00:00:00Z" }),
    );
  });
  it("listing type mismatch scores lower and is tagged", () => {
    const m = f({ propertyType: "house", listing: listing({ type: "townhouse" }) });
    const ok = f({ propertyType: "house", listing: listing({ type: "house" }) });
    expect(spotScore(m, NOW)).toBeLessThan(spotScore(ok, NOW));
    expect(spotTags(m)).toContain("Listing says: townhouse");
    expect(spotTags(ok).some((t) => t.startsWith("Listing says"))).toBe(false);
  });
});

describe("tags", () => {
  it("life support is tagged and changes neither band nor score", () => {
    const a = f({ insulation: "none", insulationDetail: null });
    const b = { ...a, lifeSupport: true };
    expect(spotTags(b)).toContain("Life support");
    expect(spotBand(b)).toBe(spotBand(a));
    expect(spotScore(b, NOW)).toBe(spotScore(a, NOW));
  });
  it("street unknown -> No street address", () =>
    expect(spotTags(f({ streetKnown: false }))).toContain("No street address"));
  it("listing not checked -> Not checked yet (only with a street)", () => {
    expect(spotTags(f({ listing: listing({ checked: false }) }))).toContain("Not checked yet");
    expect(spotTags(f({ listing: null }))).toContain("Not checked yet");
    expect(spotTags(f({ listing: null, streetKnown: false }))).not.toContain("Not checked yet");
    expect(spotTags(f({ listing: listing() }))).not.toContain("Not checked yet");
  });
  it("unit and apartment count as the same type", () => {
    expect(
      spotTags(f({ propertyType: "apartment", listing: listing({ type: "Unit" }) })).some((t) =>
        t.startsWith("Listing says"),
      ),
    ).toBe(false);
  });
  it("2+ storeys with no type mismatch -> Listing says: 2 storeys", () => {
    expect(spotTags(f({ listing: listing({ storeys: 2 }) }))).toContain("Listing says: 2 storeys");
  });
});

describe("spotReason", () => {
  it("builds the plain summary", () => {
    expect(
      spotReason(
        f({
          insulation: "none",
          insulationDetail: null,
          propertyType: "house",
          areaM2: 200,
          listing: listing({ floorPlan: true }),
          roofForm: "pitched",
        }),
      ),
    ).toBe("No insulation · house · ~200 m² · floor plan found · pitched roof");
  });
});

describe("insulationDetailFromDesk", () => {
  it("maps stored desk reasons", () => {
    expect(insulationDetailFromDesk("Looks like thin/loose-fill insulation")).toBe("loose_fill");
    expect(insulationDetailFromDesk("Loose-fill insulation only")).toBe("loose_fill");
    expect(insulationDetailFromDesk("Less than R2")).toBe("under_r2");
    expect(insulationDetailFromDesk("Owner-declared existing insulation")).toBeNull();
    expect(insulationDetailFromDesk(null)).toBeNull();
  });
});

describe("estimated ceiling", () => {
  it("single-storey listing floor area wins", () =>
    expect(
      estimatedCeiling(f({ listingFloorM2: 180, listing: listing({ storeys: 1 }) })),
    ).toEqual({ m2: 180, source: "listing" }));
  it("unknown storeys still uses the listing", () =>
    expect(estimatedCeiling(f({ listingFloorM2: 180, listing: listing() }))?.source).toBe("listing"));
  it("2 storeys falls back to above and is tagged Check size", () => {
    const x = f({
      listingFloorM2: 180,
      listing: listing({ storeys: 2 }),
      roofGroundM2: 100,
    });
    expect(estimatedCeiling(x)).toEqual({ m2: 85, source: "above" });
    expect(spotTags(x)).toContain("Check size");
  });
  it("roof ground area x 0.85, rounded to 5", () =>
    expect(estimatedCeiling(f({ roofGroundM2: 200 }))).toEqual({ m2: 170, source: "above" }));
  it("falls back to the footprint", () =>
    expect(estimatedCeiling(f({ footprintM2: 200 }))).toEqual({ m2: 170, source: "above" }));
  it("nothing known gives null", () => expect(estimatedCeiling(f())).toBeNull());
  it("owner 100 vs estimate 170: Check size and owner said in the reason", () => {
    const x = f({ roofGroundM2: 200, areaM2: 100 });
    expect(spotTags(x)).toContain("Check size");
    expect(spotReason(x)).toContain("owner said 100 m²");
    expect(spotReason(x)).toContain("~170 m²");
  });
  it("owner close to the estimate: no tag", () =>
    expect(spotTags(f({ roofGroundM2: 200, areaM2: 150 }))).not.toContain("Check size"));
  it("size score uses the estimate, not the owner's figure", () => {
    expect(score({ roofGroundM2: 200, areaM2: 100 })).toBeCloseTo(
      score({ areaM2: 170 }),
      6,
    );
  });
  it("no estimate: score uses the owner's figure", () =>
    expect(score({ areaM2: 100 })).toBeGreaterThan(score({ areaM2: null })));
});
