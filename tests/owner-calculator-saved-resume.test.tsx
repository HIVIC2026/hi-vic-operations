import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ownerCalculatorMode, SavedSpotPanel } from "../src/components/portal/owner-calculator-view";
import { SPOT_SAVED_BODY, SPOT_SAVED_HEADING } from "../src/lib/save-spot-offer.core";

const calc = { settings: {} };
const base = (response: Record<string, unknown> | null, withCalc = true) => ({ estimate: { estimate: withCalc ? { calc } : {} }, response }) as never;
const saved150 = { spot_saved_at: "2026-10-13T02:56:46.911Z", opted_out_at: null, saved_area_m2: 150, saved_total: 3728, saved_veu_discount: 1470, saved_gross_total: 5198 };
const saved180 = { spot_saved_at: "2026-10-13T02:58:52.802Z", opted_out_at: null, saved_area_m2: 180, saved_total: 4348, saved_veu_discount: 1750, saved_gross_total: 6098 };

describe("owner calculator: already-saved resume", () => {
  for (const keep of ["original", undefined] as const) {
    test(`saved 150 shows saved state, never re-save (keep=${keep})`, () => {
      expect(ownerCalculatorMode({ data: base(saved150), loading: false, error: false })).toBe("saved");
      const html = renderToStaticMarkup(<SavedSpotPanel response={saved150 as never} />);
      expect(html).toContain(SPOT_SAVED_HEADING);
      expect(html).toContain(SPOT_SAVED_BODY.replace("’", "’"));
      expect(html).toContain("150 m²"); expect(html).toContain("$3,728"); expect(html).toContain("$1,470");
      expect(html).not.toMatch(/Yes, save my spot|Save My Spot —/);
    });
  }
  test("saved 180 with no current estimate shows saved 180 snapshot, never 150", () => {
    expect(ownerCalculatorMode({ data: base(saved180, false), loading: false, error: false })).toBe("saved");
    const html = renderToStaticMarkup(<SavedSpotPanel response={saved180 as never} />);
    expect(html).toContain("180 m²"); expect(html).toContain("$4,348"); expect(html).toContain("$1,750");
    expect(html).not.toContain("150 m²"); expect(html).not.toContain("$3,728");
  });
  test("missing snapshot fields fail closed: heading/body only, no figures", () => {
    const html = renderToStaticMarkup(<SavedSpotPanel response={{ spot_saved_at: "x", opted_out_at: null, saved_area_m2: 180, saved_total: null, saved_veu_discount: null } as never} />);
    expect(html).toContain(SPOT_SAVED_HEADING);
    expect(html).not.toMatch(/\$\d/); expect(html).not.toContain("m²");
  });
  test("unsaved, opted-out, loading and broken states keep their existing modes", () => {
    expect(ownerCalculatorMode({ data: base({ spot_saved_at: null, opted_out_at: null }), loading: false, error: false })).toBe("offer");
    expect(ownerCalculatorMode({ data: base(null), loading: false, error: false })).toBe("offer");
    expect(ownerCalculatorMode({ data: base({ ...saved150, opted_out_at: "2026-10-13T00:00:00Z" }), loading: false, error: false })).toBe("opted_out");
    expect(ownerCalculatorMode({ data: undefined, loading: true, error: false })).toBe("loading");
    expect(ownerCalculatorMode({ data: base({ spot_saved_at: null, opted_out_at: null }, false), loading: false, error: false })).toBe("unavailable");
    expect(ownerCalculatorMode({ data: null, loading: false, error: false })).toBe("unavailable");
  });
});
