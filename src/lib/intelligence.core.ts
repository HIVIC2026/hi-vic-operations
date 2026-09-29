// Gate 1 Property Intelligence – PURE logic (no network, no database). Deterministic and tested.
// NEVER fabricate: unknown stays unknown; absence of evidence is never a "no".
// Gate 1 categorisation is NOT decided here – see eligibility.core (single authoritative engine).

export const RULESET = {
  version: "A48-2026.1",
  source: "VEU Specifications 2018 v25.0 / Ceiling Insulation Amendment Regulations 2026",
  rules: [
    { id: "premises", text: "Residential premises classified Class 1, or a sole-occupancy unit of a Class 2 building." },
    { id: "age_5y", text: "Relevant ceiling not constructed, and not above a floor/other structure constructed, in the 5 years before the activity date." },
    { id: "relevant_ceiling", text: "Ceiling within the premises with a roof cavity or an exposed roof above it, and not another storey." },
    { id: "whole_ceiling", text: "Every luminaire IC/IC-4; no insulation other than qualifying reflective foil and/or uncompressed insulation averaging < R2.0 (ONSITE)." },
    { id: "piesa_30d", text: "Installation must commence within 30 days of PIESA." },
    { id: "piesa_copy_24h", text: "PIESA copy provided to owner and installer no less than 24h before the activity." },
    { id: "esc_consent_24h", text: "Written owner consent for ESC information sharing obtained no less than 24h before the activity." },
    { id: "esc_notice_24h", text: "AP sends required notification details to ESC no less than 24h before the activity." },
    { id: "reg_23a", text: "Reg 23A consent covers installation day(s), premises address, owner contact details and other specified details; ESC may share with WorkSafe (VWA) and Energy Safe Victoria." },
    { id: "copayment", text: "Minimum customer co-payment $200 inc GST." },
  ],
} as const;
export const MIN_COPAYMENT_INC_GST = 200;

export type Confidence = "very_high" | "high" | "medium" | "low" | "unknown";
export type CheckStatus = "pass" | "review" | "fail" | "unknown" | "info";
export type Fact = {
  key: string; value: unknown; status: CheckStatus;
  sourceType: "public_gis" | "partner" | "provider" | "owner" | "portal" | "derived" | "not_configured";
  sourceName: string; sourceUrl?: string | null; sourceRecordId?: string | null; sourceDate?: string | null;
  confidence: Confidence; evidence: "direct" | "inferred" | "none"; note?: string | undefined; raw?: unknown;
};

// ---------- Address normalisation (Vicmap ezi_address style) ----------
const ROAD_TYPES: Record<string, string> = {
  rd: "ROAD", st: "STREET", str: "STREET", ave: "AVENUE", av: "AVENUE", ct: "COURT", crt: "COURT", cres: "CRESCENT", cr: "CRESCENT",
  dr: "DRIVE", pl: "PLACE", tce: "TERRACE", hwy: "HIGHWAY", pde: "PARADE", cl: "CLOSE", gr: "GROVE", gv: "GROVE", ln: "LANE",
  bvd: "BOULEVARD", blvd: "BOULEVARD", cct: "CIRCUIT", sq: "SQUARE", wy: "WAY", esp: "ESPLANADE", rise: "RISE", hts: "HEIGHTS",
};
export type AddressQuery = { number: string; unit: string | null; street: string; postcode: string | null; locality: string | null; prefix: string };
export function normaliseAddress(line: string, suburb?: string | null, postcode?: string | null): AddressQuery | null {
  let s = ` ${line} ${suburb ?? ""} `.toUpperCase().replace(/[,]/g, " ").replace(/\s+/g, " ");
  s = s.replace(/\b(VIC|VICTORIA|AUSTRALIA)\b/g, " ");
  const pcIn = postcode?.trim() || (s.match(/\b(3\d{3}|8\d{3})\b/)?.[1] ?? null);
  s = s.replace(/\b\d{4}\b\s*$/, " ").replace(/\s+/g, " ").trim();
  let unit: string | null = null;
  const u = s.match(/^(?:UNIT|U|APT|FLAT)?\s*(\d+[A-Z]?)\s*\/\s*(.*)$/);
  if (u) { unit = u[1]!; s = u[2]!; }
  const m = s.match(/^(\d+[A-Z]?(?:-\d+[A-Z]?)?)\s+(.+)$/);
  if (!m) return null;
  const words = m[2]!.split(" ").map((w) => ROAD_TYPES[w.toLowerCase()] ?? w);
  const typeIdx = words.findIndex((w) => Object.values(ROAD_TYPES).includes(w));
  const street = (typeIdx >= 0 ? words.slice(0, typeIdx + 1) : words.slice(0, 2)).join(" ");
  const locality = typeIdx >= 0 ? words.slice(typeIdx + 1).join(" ") || null : null;
  const number = m[1]!;
  return { number, unit, street, postcode: pcIn, locality, prefix: `${number} ${street}` };
}
export const cqlString = (s: string) => s.replace(/'/g, "''").replace(/[%_]/g, "");

// ---------- Vicmap WFS response parsers ----------
type Feature = { properties?: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } | null };
type FC = { features?: Feature[] } | null | undefined;
export const VICMAP_WFS = "https://opendata.maps.vic.gov.au/geoserver/wfs";

export function parseAddress(fc: FC, q: AddressQuery): { facts: Fact[]; point: [number, number] | null; propertyPfi: string | null } {
  const src = { sourceType: "public_gis" as const, sourceName: "Vicmap Address (open-data-platform:address)", sourceUrl: VICMAP_WFS };
  const feats = (fc?.features ?? []).filter((f) => {
    const p = f.properties ?? {};
    return !q.postcode || String(p["postcode"] ?? "") === q.postcode;
  });
  const primary = feats.filter((f) => f.properties?.["is_primary"] === "Y");
  const pick = (primary.length ? primary : feats);
  if (!pick.length) return { point: null, propertyPfi: null, facts: [
    { key: "address_verified", value: false, status: "review", ...src, confidence: "unknown", evidence: "none", note: "No Vicmap address match – check spelling / unit" },
  ] };
  const distinct = new Set(pick.map((f) => f.properties?.["property_pfi"]));
  const f = pick[0]!; const p = f.properties ?? {};
  const coords = f.geometry?.type === "Point" ? (f.geometry.coordinates as [number, number]) : null;
  const ambiguous = distinct.size > 1;
  const state = String(p["state"] ?? "");
  return {
    point: coords, propertyPfi: ambiguous ? null : (p["property_pfi"] as string) ?? null,
    facts: [
      { key: "address_verified", value: !ambiguous, status: ambiguous ? "review" : "pass", ...src, sourceRecordId: String(p["pfi"] ?? ""), sourceDate: (p["source_verified"] as string | undefined)?.slice(0, 10) ?? null, confidence: ambiguous ? "low" : "high", evidence: "direct", note: ambiguous ? `${distinct.size} matching properties – confirm unit/lot` : undefined, raw: p },
      { key: "normalized_address", value: p["ezi_address"] ?? null, status: "info", ...src, sourceRecordId: String(p["pfi"] ?? ""), confidence: ambiguous ? "low" : "high", evidence: "direct" },
      { key: "in_victoria", value: state === "VIC", status: state === "VIC" ? "pass" : "fail", ...src, confidence: "high", evidence: "direct" },
      { key: "coordinates", value: coords, status: "info", ...src, confidence: coords ? "high" : "unknown", evidence: coords ? "direct" : "none" },
    ],
  };
}

export function parseProperty(fc: FC): Fact[] {
  const src = { sourceType: "public_gis" as const, sourceName: "Vicmap Property (open-data-platform:v_property_mp)", sourceUrl: VICMAP_WFS };
  const f = fc?.features?.[0];
  if (!f) return [{ key: "property_identifier", value: null, status: "unknown", ...src, confidence: "unknown", evidence: "none", note: "No property polygon match" }];
  const p = f.properties ?? {};
  const multi = p["prop_multi_assessment"] === "Y";
  // Parcel/property polygon AREA is deliberately never read: parcel area is not ceiling area.
  return [
    { key: "property_identifier", value: { pfi: p["prop_pfi"], propnum: p["prop_propnum"], lga_code: p["prop_lga_code"] ?? null }, status: "info", ...src, sourceRecordId: String(p["prop_pfi"] ?? ""), confidence: "high", evidence: "direct" },
    { key: "multi_assessment_property", value: multi, status: multi ? "review" : "info", ...src, confidence: "medium", evidence: "direct", note: multi ? "Multi-assessment property – possible units / Class 2; confirm sole-occupancy unit" : undefined },
  ];
}

const RES_ZONES = /^(GRZ|NRZ|RGZ|LDRZ|MUZ|TZ|HCTZ)/;
const NON_RES_ZONES = /^(C1Z|C2Z|C3Z|IN1Z|IN2Z|IN3Z|CCZ|PPRZ|PCRZ|PUZ|SUZ|FZ|RCZ|GWZ|UFZ|CA|DZ|ACZ|PDZ|RDZ)/;
export function parseZone(fc: FC): Fact[] {
  const src = { sourceType: "public_gis" as const, sourceName: "Vicmap Planning zones (open-data-platform:plan_zone)", sourceUrl: VICMAP_WFS };
  const f = fc?.features?.[0];
  if (!f) return [
    { key: "planning_zone", value: null, status: "unknown", ...src, confidence: "unknown", evidence: "none" },
    { key: "residential_likelihood", value: "unknown", status: "unknown", ...src, sourceType: "derived", confidence: "unknown", evidence: "none", note: "No planning zone found" },
  ];
  const p = f.properties ?? {};
  const code = String(p["zone_code"] ?? "");
  const like = RES_ZONES.test(code) ? "medium" : NON_RES_ZONES.test(code) ? "low" : "unknown";
  return [
    { key: "planning_zone", value: { code, description: p["zone_description"] ?? null, lga: p["lga"] ?? null }, status: "info", ...src, sourceRecordId: code, confidence: "high", evidence: "direct", raw: p },
    // Zoning is an INDICATOR only: it never proves NCC Class 1 / Class 2 SOU, and never alone disqualifies.
    { key: "residential_likelihood", value: like, status: like === "medium" ? "review" : like === "low" ? "review" : "unknown", ...src, sourceType: "derived", confidence: like === "unknown" ? "unknown" : "low", evidence: "inferred", note: `Zone ${code} is an indicator only – not proof of NCC class` },
  ];
}

// ---------- Ceiling area source hierarchy ----------
export type AreaTier = "A" | "B" | "C" | "D" | "E" | "F";
export const TIER_LABEL: Record<AreaTier, string> = {
  A: "Partner/imported measured ceiling area", B: "Sourced floor plan", C: "Verified building footprint", D: "Sourced listing floor area", E: "Building ground footprint estimate (aerial/Solar)", F: "Owner estimate",
};
export const TIER_CONFIDENCE: Record<AreaTier, Confidence> = { A: "very_high", B: "high", C: "medium", D: "low", E: "medium", F: "low" };
const RANK: Record<AreaTier, number> = { A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
export type AreaEstimate = { id?: string; tier: AreaTier; net_m2: number | null; created_at?: string; method?: string };
/** A candidate may only replace the current estimate if it is from an equal-or-stronger tier. */
export function canReplace(current: AreaEstimate | null, candidate: AreaEstimate): boolean {
  if (!(Number(candidate.net_m2) > 0)) return false;
  if (!current) return true;
  return RANK[candidate.tier] >= RANK[current.tier];
}
export function selectCurrentEstimate(all: AreaEstimate[]): AreaEstimate | null {
  return all.filter((e) => Number(e.net_m2) > 0).sort((a, b) => RANK[b.tier] - RANK[a.tier] || String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null;
}
export const PARCEL_AREA_IS_NEVER_CEILING_AREA = true;

// ---------- Age evidence ----------
export type AgeStatus = "strong_over_5y" | "supporting_over_5y" | "recent_under_5y" | "unknown";
/** Age status from a sourced date. Only 'historical_imagery_same_footprint' or partner/direct records are strong; listings are supporting only. */
export function ageStatusFor(e: { date: string | null; kind: "historical_imagery_same_footprint" | "direct_record" | "listing_year_built" | "imagery_building_detected" | "none" }, referenceDate: string): AgeStatus {
  if (!e.date || e.kind === "none") return "unknown";
  const ref = new Date(referenceDate); const d = new Date(e.date);
  const fiveBefore = new Date(ref); fiveBefore.setFullYear(ref.getFullYear() - 5);
  const older = d <= fiveBefore;
  if (e.kind === "listing_year_built" || e.kind === "imagery_building_detected") return older ? "supporting_over_5y" : "unknown"; // listing year cannot prove "recent" for the relevant ceiling either
  if (older) return "strong_over_5y";
  return e.kind === "direct_record" ? "recent_under_5y" : "unknown";
}

// ---------- Gate 1: NO independent engine here ----------
// Property Intelligence only gathers facts. Its diagnostic recommendation is produced by the ONE authoritative
// categoriser in eligibility.core (evaluateGate1) so the two can never disagree.
import { evaluateGate1, resolveGate1Facts, ONSITE_ALWAYS as A48_ONSITE, type Gate1Facts, type IntelFact } from "./eligibility.core";
export type Gate1Input = Gate1Facts;
export type Recommendation = { outcome: "likely_eligible" | "needs_onsite_confirmation" | "does_not_appear_eligible" | null; reviewRequired: boolean; reasons: string[]; nextAction: string; onsite: string[] };
export const ONSITE_ALWAYS = A48_ONSITE;

export function recommendGate1(f: Gate1Facts): Recommendation {
  const d = evaluateGate1(f);
  const reasons = d.failed.length ? d.failed : d.review.length ? d.review : d.onsite.length ? d.onsite : ["All remote Gate 1 checks satisfied – pending onsite insulation, lighting and electrical confirmation"];
  return { outcome: d.outcome, reviewRequired: d.reviewRequired, reasons, nextAction: d.nextAction, onsite: d.onsiteRequirements };
}

export function factsToIntel(facts: Fact[]): IntelFact[] {
  return facts.map((f) => ({ fact_key: f.key, value: f.value, evidence_kind: f.evidence, confidence: f.confidence, source_type: f.sourceType, source_name: f.sourceName, source_url: f.sourceUrl ?? null, is_current: true, is_stale: false }));
}

/** Intelligence-only facts (no portal/Base44 data) resolved through the same fact resolver as the authoritative decider. */
export function gate1InputFromFacts(facts: Fact[], referenceDate: string): Gate1Facts {
  return resolveGate1Facts(null, { lifeSupportStatus: null, preliminaryOutcome: null, referenceDate }, 5, Number(referenceDate.slice(0, 4)), factsToIntel(facts));
}

export const COMPLETENESS_KEYS = ["address_verified", "in_victoria", "planning_zone", "residential_likelihood", "ncc_class_evidence", "age_evidence", "roof_form", "another_storey_above_relevant_ceiling", "floorplan_status", "preliminary_ceiling_area"];
export function completeness(facts: Fact[]): number {
  const known = COMPLETENESS_KEYS.filter((k) => { const f = facts.find((x) => x.key === k); return f && f.evidence !== "none" && f.value !== null && f.value !== "unknown"; });
  return Math.round((known.length / COMPLETENESS_KEYS.length) * 100);
}

export function addressHash(line: string, suburb?: string | null, postcode?: string | null) {
  return `${line}|${suburb ?? ""}|${postcode ?? ""}`.toUpperCase().replace(/\s+/g, " ").trim();
}
export const STALE_AFTER_DAYS = 90;
