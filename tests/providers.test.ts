import { describe, expect, test } from "bun:test";
import { ageStatusFor, canReplace, gate1InputFromFacts, recommendGate1, selectCurrentEstimate } from "../src/lib/intelligence.core";
import { gatherEvidence, type FetchJson } from "../src/lib/intelligence.gather";
import { analyseNearmap, mayCopyFile, parsePricefinderExtended, parseSolar, parseStoragePolicy, planFloorplans, resolvePricefinder, type SolarInsights } from "../src/lib/providers.core";
import { providerConfigFromEnv, providerStatuses, runProviders, type ProviderHttp } from "../src/lib/providers.gather";
import { trustedIntel } from "../src/lib/eligibility.core";

const POINT: [number, number] = [145.261521, -37.895724];
const ADDRESS_FC = { features: [{ geometry: { type: "Point", coordinates: POINT }, properties: { pfi: "1", property_pfi: "1296847", ezi_address: "3 LUCERNE ROAD FERNTREE GULLY 3156", state: "VIC", postcode: "3156", is_primary: "Y" } }] };
const vicmap: FetchJson = async (url) => ({ status: 200, json: url.includes("typeNames=open-data-platform%3Aaddress") ? ADDRESS_FC : url.includes("v_property_mp") ? { features: [{ properties: { prop_pfi: "1296847", prop_status: "A" } }] } : { features: [{ properties: { zone_code: "NRZ4", zone_description: "NEIGHBOURHOOD RESIDENTIAL ZONE" } }] } });

const SOLAR: SolarInsights = {
  name: "buildings/X", center: { latitude: -37.89574, longitude: 145.26150 }, boundingBox: { sw: { latitude: -37.8960, longitude: 145.2612 }, ne: { latitude: -37.8955, longitude: 145.2618 } },
  imageryDate: { year: 2019, month: 3, day: 4 }, imageryQuality: "HIGH",
  solarPotential: { buildingStats: { areaMeters2: 210, groundAreaMeters2: 182.4 }, roofSegmentStats: [{ pitchDegrees: 22, stats: { groundAreaMeters2: 90 } }, { pitchDegrees: 23, stats: { groundAreaMeters2: 92 } }] },
};
const PF_SUGGEST = { matches: [{ property: { id: 555 }, address: { streetAddress: "3 Lucerne Rd", postcode: "3156" } }, { property: { id: 556 }, address: { streetAddress: "33 Lucerne Rd", postcode: "3156" } }] };

const http = (o: { solar?: unknown; solarStatus?: number; floorplans?: unknown; extended?: unknown; fail?: string[]; nearmap?: { surveys: { id: string; captureDate: string }[]; areas: Record<string, number> } } = {}): ProviderHttp => async (url) => {
  if (o.fail?.some((f) => url.includes(f))) throw new Error("timeout (aborted)");
  if (url.includes("oauth2/token")) return { status: 200, json: { access_token: "t" } };
  if (url.includes("suggest")) return { status: 200, json: PF_SUGGEST };
  if (url.includes("/extended")) return { status: 200, json: o.extended ?? { features: { yearBuilt: 1985, storeys: 1, floorArea: 160 } } };
  if (url.includes("floorplans")) return { status: 200, json: o.floorplans ?? [] };
  if (url.includes("solar.googleapis")) return { status: o.solarStatus ?? 200, json: o.solar ?? SOLAR };
  if (url.includes("coverage")) return { status: 200, json: { surveys: o.nearmap?.surveys ?? [] } };
  if (url.includes("features.json")) { const id = new URL(url).searchParams.get("surveyResourceId")!; return { status: 200, json: { features: [{ description: "Building", areaSqm: o.nearmap!.areas[id] }, { description: "Roof", attributes: [{ pitch: 22 }] }] } }; }
  return { status: 404, json: null };
};
const base = { addressLine: "3 Lucerne Rd", suburb: "Ferntree Gully", postcode: "3156", state: "VIC", ownerEstimateM2: 140, partnerMeasurement: null, provider: null };
const all = providerConfigFromEnv({ PRICEFINDER_CLIENT_ID: "a", PRICEFINDER_CLIENT_SECRET: "b", GOOGLE_SOLAR_API_KEY: "k", NEARMAP_API_KEY: "n" });

describe("licensed providers", () => {
  test("Pricefinder exact address resolution (ambiguous prefix not selected)", () => {
    expect(resolvePricefinder(PF_SUGGEST, "3 LUCERNE ROAD", "3156").id).toBe("555");
    expect(resolvePricefinder({ matches: [PF_SUGGEST.matches[0], { property: { id: 9 }, address: { streetAddress: "3 Lucerne Road", postcode: "3156" } }] }, "3 LUCERNE ROAD", "3156").id).toBeNull();
  });
  test("floorplan found / not found / multiple conflicting", () => {
    expect(planFloorplans([], "1").fact.value).toBe("not_found");
    const one = planFloorplans([{ id: 1, url: "u", date: "2020-01-01" }], "1");
    expect(one.fact.value).toBe("provider_sourced"); expect(one.rows[0].is_candidate).toBe(true);
    const many = planFloorplans([{ id: 1, date: "2010-01-01", floorArea: 120 }, { id: 2, date: "2021-01-01", floorArea: 190 }], "1");
    expect(many.rows).toHaveLength(2); expect(many.rows.some((r) => r.is_candidate)).toBe(false);
  });
  test("storage licence flag fails closed", () => {
    expect(parseStoragePolicy(undefined)).toBe("unknown"); expect(parseStoragePolicy("yes")).toBe("unknown");
    expect(mayCopyFile("unknown")).toBe(false); expect(mayCopyFile("reference_only")).toBe(false); expect(mayCopyFile("store_permitted")).toBe(true);
  });
  test("Solar uses groundArea, never roof area", () => {
    const r = parseSolar(SOLAR, POINT, false);
    expect(r.area?.net_m2).toBe(182.4); expect(r.area?.tier).toBe("E"); expect(r.area?.confidence).toBe("low");
    expect(r.area?.notes).toContain("NOT ceiling area");
  });
  test("Solar imagery date is supporting age only", () => {
    const f = parseSolar(SOLAR, POINT, false).facts.find((x) => x.key === "age_supporting_solar")!;
    expect(ageStatusFor(f.value as never, "2026-09-28")).toBe("supporting_over_5y");
    expect(trustedIntel({ fact_key: "age_evidence", value: f.value, is_current: true, is_stale: false, evidence_kind: f.evidence, confidence: "high", source_type: "provider", source_name: "x", source_url: null } as never)).toBe(false);
  });
  test("Solar flat/low pitch => review, not fail", () => {
    const flat = { ...SOLAR, solarPotential: { ...SOLAR.solarPotential, roofSegmentStats: [{ pitchDegrees: 3, stats: { groundAreaMeters2: 180 } }] } };
    const f = parseSolar(flat, POINT, false).facts;
    expect(f.find((x) => x.key === "roof_form")?.value).toBe("low_slope_flat");
    expect(recommendGate1(gate1InputFromFacts(f, "2026-09-28")).outcome).toBe("needs_onsite_confirmation");
  });
  test("centre/parcel mismatch rejects Solar", () => {
    const far = { ...SOLAR, center: { latitude: -37.8990, longitude: 145.2650 } };
    const r = parseSolar(far, POINT, false); expect(r.match.ok).toBe(false); expect(r.area).toBeNull();
  });
  test("provider failure => partial run, others continue", async () => {
    const r = await runProviders(all, { prefix: "3 LUCERNE ROAD", postcode: "3156", point: POINT, referenceDate: "2026-09-28" }, http({ fail: ["solar.googleapis"], nearmap: { surveys: [], areas: {} } }));
    expect(r.checks.find((c) => c.source_key === "google_solar")?.status).toBe("timeout");
    expect(r.checks.find((c) => c.source_key === "pricefinder")?.status).toBe("ok");
    expect(r.checks.find((c) => c.source_key === "nearmap")?.status).toBe("no_coverage");
  });
  test("partner area wins over Solar/listing; onsite measurement never overwritten", async () => {
    const g = await gatherEvidence({ ...base, partnerMeasurement: { net_m2: 118, source: "Onsite measure-up (accepted)", external_id: null }, providers: { cfg: all, http: http({ nearmap: { surveys: [], areas: {} } }), referenceDate: "2026-09-28" } }, vicmap);
    expect(g.areas.map((a) => a.tier)).toEqual(["A"]);
    expect(canReplace({ tier: "A", net_m2: 118 }, { tier: "E", net_m2: 182 })).toBe(false);
    expect(selectCurrentEstimate([{ tier: "E", net_m2: 182 }, { tier: "D", net_m2: 160 }, { tier: "B", net_m2: 130 }])?.tier).toBe("B");
  });
  test("Pricefinder yearBuilt cannot hard-pass age", () => {
    const f = parsePricefinderExtended({ features: { yearBuilt: 1970 } }, "1").facts[0];
    expect(ageStatusFor(f.value as never, "2026-09-28")).toBe("supporting_over_5y");
    expect(recommendGate1({ addressVerified: true, inVictoria: true, residentialLikelihood: "high", nccClass: { value: "class1", direct: true }, ageStatus: "supporting_over_5y", recentExtensionRisk: "no", roofForm: "pitched", roofCavityOrExposed: "likely", storeyAbove: "no", noRelevantCeilingDirect: false }).outcome).toBe("needs_onsite_confirmation");
  });
  test("Nearmap historical same footprint => strong >5y direct evidence", () => {
    const f = analyseNearmap([{ id: "s1", captureDate: "2019-02-01", buildingFootprintM2: 180 }, { id: "s2", captureDate: "2026-06-01", buildingFootprintM2: 183 }], "2026-09-28");
    const age = f.find((x) => x.key === "age_evidence")!;
    expect(ageStatusFor(age.value as never, "2026-09-28")).toBe("strong_over_5y");
    expect(age.evidence).toBe("direct");
  });
  test("Nearmap recent change flags extension risk and prevents auto-pass", () => {
    const f = analyseNearmap([{ id: "s1", captureDate: "2019-02-01", buildingFootprintM2: 150 }, { id: "s2", captureDate: "2024-06-01", buildingFootprintM2: 210 }], "2026-09-28");
    expect(f.find((x) => x.key === "recent_extension_or_added_storey_risk")?.value).toBe("yes");
    expect(recommendGate1(gate1InputFromFacts(f, "2026-09-28")).outcome).toBe("needs_onsite_confirmation");
  });
  test("no credentials => provider_not_configured, not errors", async () => {
    const cfg = providerConfigFromEnv({});
    const r = await runProviders(cfg, { prefix: "3 LUCERNE ROAD", postcode: "3156", point: POINT, referenceDate: "2026-09-28" }, async () => { throw new Error("must not be called"); });
    expect(r.checks.every((c) => c.status === "not_configured")).toBe(true);
    const s = providerStatuses(cfg);
    expect(s.find((x) => x.key === "vicmap")?.state).toBe("ready");
    expect(s.filter((x) => x.key !== "vicmap").every((x) => x.state === "not_configured")).toBe(true);
    const g = await gatherEvidence({ ...base, providers: { cfg, http: http(), referenceDate: "2026-09-28" } }, vicmap);
    expect(g.facts.find((f) => f.key === "floorplan_status")?.value).toBe("provider_not_configured");
  });
  test("full chain: Solar tier E added, Nearmap sets roof and age", async () => {
    const g = await gatherEvidence({ ...base, providers: { cfg: all, http: http({ floorplans: [{ id: 7, date: "2015-01-01" }], nearmap: { surveys: [{ id: "a", captureDate: "2019-01-01" }, { id: "b", captureDate: "2026-05-01" }], areas: { a: 180, b: 181 } } }), referenceDate: "2026-09-28" } }, vicmap);
    expect(g.areas.map((a) => a.tier).sort()).toEqual(["D", "E", "F"]);
    expect(g.facts.find((f) => f.key === "roof_form")?.sourceName).toBe("Nearmap roof geometry");
    expect((g.facts.find((f) => f.key === "age_evidence")?.value as { kind: string }).kind).toBe("historical_imagery_same_footprint");
    expect(g.floorplans).toHaveLength(1); expect(g.storagePolicy).toBe("unknown");
  });
});
