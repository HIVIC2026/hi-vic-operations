import { describe, expect, test } from "bun:test";
import { parseSolar, solarAreaConflict, solarRoofRisk, solarSummary, type SolarInsights } from "../src/lib/providers.core";
import { runSolar, runProviders, providerConfigFromEnv, type ProviderHttp, type ProviderResult } from "../src/lib/providers.gather";
import { canReplace, selectCurrentEstimate } from "../src/lib/intelligence.core";

const POINT: [number, number] = [145.261521, -37.895724];
const S: SolarInsights = {
  name: "buildings/X", center: { latitude: -37.89574, longitude: 145.2615 }, boundingBox: { sw: { latitude: -37.896, longitude: 145.2612 }, ne: { latitude: -37.8955, longitude: 145.2618 } },
  imageryDate: { year: 2022, month: 5, day: 3 }, imageryQuality: "BASE",
  solarPotential: { wholeRoofStats: { areaMeters2: 205, groundAreaMeters2: 188 }, buildingStats: { areaMeters2: 210, groundAreaMeters2: 182.4 },
    roofSegmentStats: [{ pitchDegrees: 20, stats: { groundAreaMeters2: 100 } }, { pitchDegrees: 3, stats: { groundAreaMeters2: 80 } }] },
};
const empty = (): ProviderResult => ({ facts: [], checks: [], areas: [], floorplans: [], storagePolicy: "unknown" });
const ctx = { prefix: "3 LUCERNE ROAD", postcode: "3156", point: POINT, referenceDate: "2026-09-28" };
const seq = (...rs: { status: number; json: unknown }[]) => { const urls: string[] = []; const h: ProviderHttp = async (u) => { urls.push(u); return rs[Math.min(urls.length - 1, rs.length - 1)]; }; return { h, urls }; };

describe("Google Solar", () => {
  test("successful parse: all summary values, provenance, BASE area kept low", () => {
    const x = solarSummary(S);
    expect(x).toMatchObject({ building_ground_area_m2: 182.4, roof_ground_area_m2: 188, roof_surface_area_m2: 205, segment_count: 2, pitch_min_deg: 3, pitch_max_deg: 20, imagery_quality: "BASE", imagery_date: "2022-05-03", roof_form: "mixed" });
    expect(x.weighted_pitch_deg).toBeCloseTo(12.4, 1);
    const p = parseSolar(S, POINT, false);
    expect((p.facts.find((f) => f.key === "solar_summary")!.value as { basis: string; source: string })).toMatchObject({ basis: "mapped_remote_estimate", source: "google_solar" });
    expect(p.area).toMatchObject({ tier: "E", net_m2: 182.4, confidence: "low" });
  });
  test("roof risk is operational review, never fail", () => {
    const f = parseSolar(S, POINT, false).facts.find((x) => x.key === "site_roof_risk")!;
    expect(f.status).toBe("review");
    expect(solarRoofRisk({ ...solarSummary(S), segment_count: 9, roof_form: "pitched" }).flags[0]).toContain("complex");
  });
  test("BASE requested first", async () => {
    const { h, urls } = seq({ status: 200, json: S }); const o = empty();
    await runSolar("k", ctx, h, o);
    expect(urls).toHaveLength(1); expect(urls[0]).toContain("requiredQuality=BASE"); expect(o.checks[0].status).toBe("ok");
  });
  test("403 key restriction => no_entitlement, no retry, key not in error", async () => {
    const { h, urls } = seq({ status: 403, json: { error: { status: "PERMISSION_DENIED" } } }); const o = empty();
    await runSolar("SECRETKEY", ctx, h, o);
    expect(urls).toHaveLength(1); expect(o.checks[0].status).toBe("no_entitlement"); expect(o.checks[0].error).not.toContain("SECRETKEY");
  });
  test("404 => no_coverage", async () => { const o = empty(); await runSolar("k", ctx, seq({ status: 404, json: null }).h, o); expect(o.checks[0].status).toBe("no_coverage"); expect(o.areas).toHaveLength(0); });
  test("5xx retries once with MEDIUM only", async () => {
    const { h, urls } = seq({ status: 503, json: null }, { status: 503, json: null }); const o = empty();
    await runSolar("k", ctx, h, o);
    expect(urls).toHaveLength(2); expect(urls[1]).toContain("requiredQuality=MEDIUM"); expect(o.checks[0].retry_count).toBe(1);
  });
  test("missing key => not_configured, no call", async () => {
    const r = await runProviders(providerConfigFromEnv({}), ctx, async () => { throw new Error("must not call"); });
    expect(r.checks.find((c) => c.source_key === "google_solar")?.status).toBe("not_configured");
  });
  test("timeout degrades gracefully", async () => {
    const r = await runProviders(providerConfigFromEnv({ GOOGLE_SOLAR_API_KEY: "k" }), ctx, async () => { throw new Error("The operation was aborted"); });
    expect(r.checks.find((c) => c.source_key === "google_solar")?.status).toBe("timeout");
  });
  test("hierarchy: floor plan outranks Solar, Solar outranks owner estimate", () => {
    expect(canReplace({ tier: "B", net_m2: 150 }, { tier: "E", net_m2: 182 })).toBe(false);
    expect(canReplace({ tier: "F", net_m2: 140 }, { tier: "E", net_m2: 182 })).toBe(true);
    expect(selectCurrentEstimate([{ tier: "F", net_m2: 140 }, { tier: "E", net_m2: 182 }])?.tier).toBe("E");
  });
  test("conflict flagged vs exact floor plan, not vs owner estimate", () => {
    expect(solarAreaConflict(182, [{ tier: "B", net_m2: 120, source_name: "Floor plan" }])?.status).toBe("review");
    expect(solarAreaConflict(182, [{ tier: "B", net_m2: 175, source_name: "Floor plan" }])).toBeNull();
    expect(solarAreaConflict(182, [{ tier: "F", net_m2: 90, source_name: "Owner" }])).toBeNull();
  });
});
