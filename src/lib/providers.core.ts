// Pure parsers/rules for optional licensed property-data providers (Pricefinder, Google Solar, Nearmap, Vicmap Buildings).
// No network, no database. Every output is labelled with provenance; nothing is invented.
import type { Confidence, Fact } from "./intelligence.core";

export type ProviderKey = "vicmap" | "pricefinder" | "google_solar" | "nearmap" | "vicmap_buildings";
export type ProviderState = "ready" | "configured" | "not_configured" | "no_coverage" | "no_entitlement" | "error";
export type StoragePolicy = "store_permitted" | "reference_only" | "unknown";

/** Conservative, configurable thresholds. */
export const PROVIDER_THRESHOLDS = {
  lowSlopeDeg: 10,            // segments below this pitch count as low-slope/flat
  flatShare: 0.8,             // >= share of ground area low-slope => low_slope_flat
  mixedShare: 0.2,            // >= share low-slope => mixed
  solarMaxCenterDistanceM: 35,// building centre must be this close to the Vicmap address point
  solarBoxPaddingM: 10,       // address point must be inside the building bbox (+ padding)
  footprintSameTolerance: 0.1,// historical vs current footprint within ±10% = same footprint
  floorplanConflictRatio: 0.15,
};

/** Licence storage policy: unknown/garbage fails closed to 'unknown' (no copy, no inline display). */
export function parseStoragePolicy(v: string | undefined | null): StoragePolicy {
  return v === "store_permitted" || v === "reference_only" ? v : "unknown";
}
export const mayCopyFile = (p: StoragePolicy) => p === "store_permitted";

// ---------- geometry ----------
export function distanceM(a: [number, number], b: [number, number]): number {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- Google Solar buildingInsights ----------
type LatLng = { latitude: number; longitude: number };
export type SolarInsights = {
  name?: string; center?: LatLng; boundingBox?: { sw: LatLng; ne: LatLng };
  imageryDate?: { year: number; month?: number; day?: number }; imageryQuality?: "HIGH" | "MEDIUM" | "LOW" | "BASE" | string;
  solarPotential?: {
    wholeRoofStats?: { areaMeters2?: number; groundAreaMeters2?: number };
    buildingStats?: { areaMeters2?: number; groundAreaMeters2?: number };
    roofSegmentStats?: { pitchDegrees?: number; azimuthDegrees?: number; stats?: { areaMeters2?: number; groundAreaMeters2?: number } }[];
  };
};

export function solarMatches(s: SolarInsights, point: [number, number] | null, t = PROVIDER_THRESHOLDS): { ok: boolean; reason: string; distance_m: number | null } {
  if (!point) return { ok: false, reason: "No verified Vicmap address point to validate against", distance_m: null };
  if (!s.center) return { ok: false, reason: "No building centre returned", distance_m: null };
  const d = distanceM(point, [s.center.longitude, s.center.latitude]);
  if (d > t.solarMaxCenterDistanceM) return { ok: false, reason: `Building centre ${Math.round(d)} m from address point (max ${t.solarMaxCenterDistanceM} m)`, distance_m: d };
  if (s.boundingBox) {
    const padLat = t.solarBoxPaddingM / 111320, padLng = t.solarBoxPaddingM / (111320 * Math.cos(point[1] * Math.PI / 180));
    const inside = point[1] >= s.boundingBox.sw.latitude - padLat && point[1] <= s.boundingBox.ne.latitude + padLat
      && point[0] >= s.boundingBox.sw.longitude - padLng && point[0] <= s.boundingBox.ne.longitude + padLng;
    if (!inside) return { ok: false, reason: "Address point is outside the returned building bounding box", distance_m: d };
  }
  return { ok: true, reason: "Building centre and bounding box consistent with address", distance_m: d };
}

export function roofFormFromSegments(segs: { pitchDegrees?: number; groundAreaM2: number }[], t = PROVIDER_THRESHOLDS): "pitched" | "low_slope_flat" | "mixed" | "unknown" {
  const valid = segs.filter((s) => typeof s.pitchDegrees === "number" && s.groundAreaM2 > 0);
  const total = valid.reduce((a, s) => a + s.groundAreaM2, 0);
  if (!total) return "unknown";
  const low = valid.filter((s) => s.pitchDegrees! < t.lowSlopeDeg).reduce((a, s) => a + s.groundAreaM2, 0) / total;
  return low >= t.flatShare ? "low_slope_flat" : low >= t.mixedShare ? "mixed" : "pitched";
}

const qualityConf = (q?: string): Confidence => q === "HIGH" ? "high" : q === "MEDIUM" ? "medium" : "low";
const isoDate = (d?: { year: number; month?: number; day?: number }) => d?.year ? `${d.year}-${String(d.month || 1).padStart(2, "0")}-${String(d.day || 1).padStart(2, "0")}` : null;

export type ProviderArea = { tier: "A" | "B" | "C" | "D" | "E" | "F"; method: string; source_name: string; source_url: string | null; gross_m2: number | null; excluded_m2: number | null; net_m2: number; confidence: string; notes: string | null; calculation: Record<string, unknown> };

export const SOLAR_URL = "https://solar.googleapis.com/v1/buildingInsights:findClosest";
/** Solar: groundAreaMeters2 = building footprint (tier E), never roof areaMeters2. Imagery date is supporting age only. */
export function parseSolar(s: SolarInsights, point: [number, number] | null, singleStoreyEvidence: boolean): { facts: Fact[]; area: ProviderArea | null; match: ReturnType<typeof solarMatches> } {
  const match = solarMatches(s, point);
  const src = { sourceType: "provider" as const, sourceName: "Google Solar buildingInsights", sourceUrl: SOLAR_URL, sourceRecordId: s.name ?? null, sourceDate: isoDate(s.imageryDate) };
  if (!match.ok) return { facts: [{ key: "solar_building_match", value: false, status: "review", ...src, confidence: "unknown", evidence: "none", note: `Solar result rejected: ${match.reason}` }], area: null, match };
  const conf = qualityConf(s.imageryQuality);
  const sp = s.solarPotential ?? {};
  const ground = Number(sp.buildingStats?.groundAreaMeters2) || null;
  const segs = (sp.roofSegmentStats ?? []).map((g) => ({ pitchDegrees: g.pitchDegrees, groundAreaM2: Number(g.stats?.groundAreaMeters2) || 0 }));
  const form = roofFormFromSegments(segs);
  const date = isoDate(s.imageryDate);
  const facts: Fact[] = [
    { key: "solar_building_match", value: true, status: "info", ...src, confidence: conf, evidence: "direct", note: match.reason, raw: { imageryDate: s.imageryDate, imageryQuality: s.imageryQuality, distance_m: match.distance_m } },
    { key: "roof_form", value: form, status: form === "pitched" ? "pass" : form === "unknown" ? "unknown" : "review", ...src, confidence: form === "unknown" ? "unknown" : conf, evidence: form === "unknown" ? "none" : "inferred", note: `Classified from ${segs.length} roof segment pitches (${s.imageryQuality ?? "unknown"} quality)${form === "low_slope_flat" || form === "mixed" ? " – flat/low-slope is review only, never a fail" : ""}`, raw: { segments: segs } },
    { key: "age_supporting_solar", value: { date, kind: "imagery_building_detected" }, status: "info", ...src, confidence: "low", evidence: "inferred", note: "Solar imagery date is supporting age evidence only – never a pass by itself" },
    { key: "building_ground_footprint", value: ground ? { m2: ground, roof_surface_m2_not_used: sp.buildingStats?.areaMeters2 ?? null } : null, status: "info", ...src, confidence: ground ? conf : "unknown", evidence: ground ? "inferred" : "none", note: "Building ground footprint estimate – not ceiling area" },
  ];
  const area: ProviderArea | null = ground && conf !== "low" ? {
    tier: "E", method: "Google Solar building ground footprint estimate", source_name: "Google Solar buildingInsights", source_url: SOLAR_URL,
    gross_m2: ground, excluded_m2: null, net_m2: Math.round(ground * 10) / 10, confidence: singleStoreyEvidence ? "medium" : "low",
    notes: singleStoreyEvidence ? "Preliminary building footprint – single-storey evidence present" : "Building ground footprint estimate, NOT ceiling area – storeys/garage unknown, review",
    calculation: { source: "google_solar.buildingStats.groundAreaMeters2", raw_m2: ground, roof_surface_area_ignored_m2: sp.buildingStats?.areaMeters2 ?? null, exclusions: [], preliminary_net_m2: ground, imagery_date: date, imagery_quality: s.imageryQuality, reason: "Horizontal footprint only; roof surface area never used as ceiling area" },
  } : null;
  return { facts, area, match };
}

// ---------- Pricefinder ----------
export const PRICEFINDER_BASE = "https://api.pricefinder.com.au/v1";
export type PfSuggest = { matches?: { property?: { id?: number | string }; display?: string; address?: { streetAddress?: string; postcode?: string; state?: string } }[] };
export type PfExtended = { propertyId?: number | string; features?: { bedrooms?: number; bathrooms?: number; landArea?: number; floorArea?: number; yearBuilt?: number; storeys?: number; garage?: boolean | number }; propertyType?: string; lastUpdated?: string };
export type PfImage = { id?: string | number; url?: string; date?: string; floorArea?: number | null };

/** Exact address resolution: exactly one match whose street address + postcode equal the normalised query. */
export function resolvePricefinder(s: PfSuggest, prefix: string, postcode: string | null): { id: string | null; reason: string } {
  const norm = (x: string) => x.toUpperCase().replace(/\bRD\b/g, "ROAD").replace(/\bST\b/g, "STREET").replace(/\bAVE?\b/g, "AVENUE").replace(/[^A-Z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  const hits = (s.matches ?? []).filter((m) => m.property?.id != null && norm(m.address?.streetAddress ?? m.display ?? "").startsWith(norm(prefix)) && (!postcode || m.address?.postcode === postcode || (m.display ?? "").includes(postcode)));
  if (hits.length === 1 && hits[0]) return { id: String(hits[0].property!.id), reason: "Exact single address match" };
  return { id: null, reason: hits.length ? `${hits.length} ambiguous matches – not selected` : "No exact address match" };
}

export function parsePricefinderExtended(e: PfExtended, id: string): { facts: Fact[]; area: ProviderArea | null; singleStorey: boolean } {
  const src = { sourceType: "provider" as const, sourceName: "Pricefinder extended property", sourceUrl: `${PRICEFINDER_BASE}/properties/${id}/extended`, sourceRecordId: id, sourceDate: e.lastUpdated ?? null };
  const f = e.features ?? {};
  const facts: Fact[] = [];
  if (f.yearBuilt) facts.push({ key: "age_supporting_pricefinder", value: { date: `${f.yearBuilt}-12-31`, kind: "listing_year_built" }, status: "info", ...src, confidence: "low", evidence: "inferred", note: "Pricefinder year built is supporting only – cannot pass age by itself" });
  facts.push({ key: "storeys_likelihood", value: f.storeys ?? "unknown", status: "info", ...src, confidence: f.storeys ? "low" : "unknown", evidence: f.storeys ? "inferred" : "none", note: "Property attribute – likelihood only, never clears storey-above check" });
  const single = f.storeys === 1 && !f.garage;
  const area: ProviderArea | null = f.floorArea && f.storeys === 1 ? {
    tier: "D", method: "Pricefinder listed floor area", source_name: "Pricefinder", source_url: src.sourceUrl, gross_m2: f.floorArea, excluded_m2: null, net_m2: f.floorArea,
    confidence: single ? "medium" : "low", notes: single ? "Listing floor area, single storey – not measured ceiling area" : "Listing floor area – garage/alfresco inclusion unknown, downgraded",
    calculation: { source: "pricefinder.features.floorArea", raw_m2: f.floorArea, exclusions: [], preliminary_net_m2: f.floorArea, storeys: f.storeys, garage: f.garage ?? "unknown", reason: "Listing area used only for single storey; never final ceiling area" },
  } : null;
  return { facts, area, singleStorey: single };
}

export type FloorplanRow = { provider: string; provider_property_id: string; provider_image_id: string; provider_url: string | null; captured_date: string | null; is_candidate: boolean; needs_review: boolean; review_reason: string | null; metadata: Record<string, unknown> };
/** Keep every floor plan; mark a candidate only when unambiguous. Areas are never computed from images. */
export function planFloorplans(imgs: PfImage[], propertyId: string, t = PROVIDER_THRESHOLDS): { rows: FloorplanRow[]; fact: Fact } {
  const src = { sourceType: "provider" as const, sourceName: "Pricefinder floorplans", sourceUrl: `${PRICEFINDER_BASE}/properties/${propertyId}/images/floorplans`, sourceRecordId: propertyId };
  const valid = imgs.filter((i) => i.id != null);
  if (!valid.length) return { rows: [], fact: { key: "floorplan_status", value: "not_found", status: "unknown", ...src, confidence: "unknown", evidence: "none", note: "Pricefinder returned no floor plans" } };
  const areas = valid.map((i) => Number(i.floorArea)).filter((a) => a > 0);
  const conflict = areas.length > 1 && (Math.max(...areas) - Math.min(...areas)) / Math.min(...areas) > t.floorplanConflictRatio;
  const sorted = [...valid].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  const best = conflict ? null : sorted[0];
  const rows = valid.map((i) => ({
    provider: "pricefinder", provider_property_id: propertyId, provider_image_id: String(i.id), provider_url: i.url ?? null, captured_date: i.date?.slice(0, 10) ?? null,
    is_candidate: best === i, needs_review: true,
    review_reason: conflict ? "Multiple floor plans with materially different configurations – admin must choose" : "Sourced floor plan – dimensions not extracted; admin review required",
    metadata: { declared_floor_area_m2: i.floorArea ?? null },
  }));
  return { rows, fact: { key: "floorplan_status", value: "provider_sourced", status: "review", ...src, confidence: "medium", evidence: "direct", note: `Sourced floor plan – Pricefinder (${valid.length})${conflict ? " – conflicting versions, no candidate selected" : ""}` } };
}

// ---------- Nearmap (normalised survey view) ----------
export const NEARMAP_BASE = "https://api.nearmap.com";
export type NearmapSurvey = { id: string; captureDate: string; buildingFootprintM2: number | null; roofPitchDeg?: number | null; product?: string };
/** Historical comparison around the cutoff. Strong age only if the same footprint existed before cutoff and no later change. */
export function analyseNearmap(surveys: NearmapSurvey[], referenceDate: string, t = PROVIDER_THRESHOLDS): Fact[] {
  const src = { sourceType: "provider" as const, sourceName: "Nearmap AI features (historical)", sourceUrl: NEARMAP_BASE };
  const cutoff = new Date(referenceDate); cutoff.setFullYear(cutoff.getFullYear() - 5);
  const dated = surveys.filter((s) => s.buildingFootprintM2 && s.buildingFootprintM2 > 0).sort((a, b) => a.captureDate.localeCompare(b.captureDate));
  const before = dated.filter((s) => new Date(s.captureDate) <= cutoff).pop();
  const after = dated.filter((s) => new Date(s.captureDate) > cutoff);
  const current = dated[dated.length - 1];
  if (!before || !current) return [
    { key: "age_evidence", value: { date: null, kind: "none" }, status: "unknown", ...src, confidence: "unknown", evidence: "none", note: "No Nearmap survey before the 5-year cutoff" },
    { key: "recent_extension_or_added_storey_risk", value: "unknown", status: "unknown", ...src, confidence: "unknown", evidence: "none" },
  ];
  const changed = after.some((s) => Math.abs(s.buildingFootprintM2! - before.buildingFootprintM2!) / before.buildingFootprintM2! > t.footprintSameTolerance);
  const prov = { surveys: dated.map((s) => ({ id: s.id, date: s.captureDate, m2: s.buildingFootprintM2, product: s.product ?? null })) };
  if (changed) return [
    { key: "age_evidence", value: { date: null, kind: "none" }, status: "review", ...src, confidence: "unknown", evidence: "none", note: "Footprint changed after the 5-year cutoff – age not proven", raw: prov },
    { key: "recent_extension_or_added_storey_risk", value: "yes", status: "review", ...src, sourceDate: current.captureDate, confidence: "high", evidence: "direct", note: "Building footprint changed since cutoff – possible recent extension", raw: prov },
  ];
  return [
    { key: "age_evidence", value: { date: before.captureDate, kind: "historical_imagery_same_footprint" }, status: "review", ...src, sourceRecordId: before.id, sourceDate: before.captureDate, confidence: "high", evidence: "direct", note: `Same footprint in Nearmap survey ${before.captureDate} and current ${current.captureDate}`, raw: prov },
    { key: "recent_extension_or_added_storey_risk", value: "no", status: "pass", ...src, sourceDate: current.captureDate, confidence: "high", evidence: "direct", note: "No footprint change since cutoff (footprint only – storeys still need confirmation)", raw: prov },
  ];
}
export function nearmapRoofFact(current: NearmapSurvey | undefined): Fact | null {
  if (current?.roofPitchDeg == null) return null;
  const form = current.roofPitchDeg < PROVIDER_THRESHOLDS.lowSlopeDeg ? "low_slope_flat" : "pitched";
  return { key: "roof_form", value: form, status: form === "pitched" ? "pass" : "review", sourceType: "provider", sourceName: "Nearmap roof geometry", sourceUrl: NEARMAP_BASE, sourceRecordId: current.id, sourceDate: current.captureDate, confidence: "high", evidence: "direct", note: form === "low_slope_flat" ? "Flat/low-slope – review only" : undefined };
}
