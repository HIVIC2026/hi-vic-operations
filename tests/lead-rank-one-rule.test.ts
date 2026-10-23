import { describe, expect, it } from "vitest";
import { leadRank, SPOT_PHOTO_CHOICES, SPOT_RANK_LABEL } from "../src/lib/spot-saved-rank.core";
import { insulationTapRoute } from "../src/lib/insulation-details.core";

const reviews = [null, "no_insulation", "below_r2", "over_r2", "unclear"] as const;
const declared = [null, "none", "present", "unknown"] as const;
const types = [undefined, "loose_fill", "batts", "unknown"];
const thick = [undefined, "thin", "hand", "thicker", "unknown"];
const built = [undefined, "1990_or_earlier", "2000_2009"];

function expected(f: any): number {
  const t = f.tap;
  if (f.reviewOutcome === "no_insulation") return 1;
  if (f.reviewOutcome === "below_r2") return f.mediaCount > 0 && !f.hadUnclearReview ? 2 : 3;
  if (f.deskLooksEligible) return 3;
  if (f.reviewOutcome === "over_r2") return 6;
  if (f.reviewOutcome === "unclear") return 7;
  if (f.declared === "none") return 4;
  if (f.buildDecade === "1990_or_earlier" || t?.house_built_period === "1990_or_earlier" || t?.insulation_type === "loose_fill" || t?.insulation_thickness === "thin" || f.declaredThinPatchy) return 5;
  if (t?.insulation_thickness === "hand" || t?.insulation_thickness === "thicker") return 6;
  if (t?.insulation_type === "unknown" || t?.insulation_thickness === "unknown" || f.declared === "unknown") return 7;
  return 8;
}

describe("leadRank — one rule everywhere", () => {
  it("every combination matches Jo's first-match table", () => {
    let n = 0;
    for (const r of reviews) for (const d of declared) for (const ty of types) for (const th of thick) for (const b of built)
      for (const media of [0, 2]) for (const unclear of [false, true]) for (const desk of [false, true]) for (const thin of [false, true]) {
        const tap = ty || th ? { insulation_type: ty, insulation_thickness: th, house_built_period: b } : null;
        const f = { reviewOutcome: r, declared: d, tap, buildDecade: tap ? null : b, mediaCount: media, hadUnclearReview: unclear, deskLooksEligible: desk, declaredThinPatchy: thin };
        expect(leadRank(f as never)).toBe(expected(f)); n++;
      }
    expect(n).toBeGreaterThan(10000);
  });
  it("photo review overrides owner answers", () => {
    const owner = { declared: "none" as const, tap: { insulation_type: "loose_fill", insulation_thickness: "thin" } };
    expect(leadRank({ ...owner, reviewOutcome: "over_r2" })).toBe(6);
    expect(leadRank({ ...owner, reviewOutcome: "unclear" })).toBe(7);
  });
  it("photo buttons come from the same rule", () => {
    expect(SPOT_PHOTO_CHOICES.map((c) => c.rank)).toEqual([1, 2, 6, 7]);
  });
  it("questions page thin wording follows rule 5 type/thickness", () => {
    expect(insulationTapRoute({ insulation_type: "loose_fill", insulation_thickness: "hand" })).toBe("thin_patchy");
    expect(insulationTapRoute({ insulation_type: "batts", insulation_thickness: "thicker" })).toBe("existing_save_spot");
  });
  it("8 labels", () => expect(Object.keys(SPOT_RANK_LABEL)).toHaveLength(8));
});
