// Gate 1 Property Intelligence – PURE logic (no network, no database). Deterministic and tested.
// NEVER fabricate: unknown stays unknown; absence of evidence is never a "no".
// Output is a PRELIMINARY recommendation only – it never moves the pipeline.

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
  A: "Partner/imported measured ceiling area", B: "Sourced floor plan", C: "Verified building footprint", D: "Sourced listing floor area", E: "Aerial/manual geometry", F: "Owner estimate",
};
export const TIER_CONFIDENCE: Record<AreaTier, Confidence> = { A: "very_high", B: "high", C: "medium", D: "low", E: "low", F: "low" };
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
export function ageStatusFor(e: { date: string | null; kind: "historical_imagery_same_footprint" | "direct_record" | "listing_year_built" | "none" }, referenceDate: string): AgeStatus {
  if (!e.date || e.kind === "none") return "unknown";
  const ref = new Date(referenceDate); const d = new Date(e.date);
  const fiveBefore = new Date(ref); fiveBefore.setFullYear(ref.getFullYear() - 5);
  const older = d <= fiveBefore;
  if (e.kind === "listing_year_built") return older ? "supporting_over_5y" : "unknown"; // listing year cannot prove "recent" for the relevant ceiling either
  if (older) return "strong_over_5y";
  return e.kind === "direct_record" ? "recent_under_5y" : "unknown";
}

// ---------- Deterministic Gate 1 recommendation ----------
export type Gate1Input = {
  addressVerified: boolean | null;
  inVictoria: boolean | null;
  residentialLikelihood: "high" | "medium" | "low" | "unknown";
  nccClass: { value: "class1" | "class2_sou" | "not_eligible" | "unknown"; direct: boolean };
  ageStatus: AgeStatus;
  recentExtensionRisk: "yes" | "no" | "unknown";
  roofForm: "pitched" | "low_slope_flat" | "mixed" | "unknown";
  roofCavityOrExposed: "likely" | "unlikely" | "unknown";
  storeyAbove: "yes" | "no" | "unknown";
  noRelevantCeilingDirect: boolean; // direct evidence no ceiling can satisfy the relevant-ceiling rule
};
export type Recommendation = { outcome: "likely_eligible" | "needs_onsite_confirmation" | "does_not_appear_eligible"; reasons: string[]; nextAction: string; onsite: string[] };
export const ONSITE_ALWAYS = [
  "Existing insulation type / R-value (< R2.0, foil / uncompressed only)",
  "All luminaires IC / IC-4",
  "Electrical safety / PIESA",
  "Measured relevant ceiling area",
];

export function recommendGate1(i: Gate1Input): Recommendation {
  const fail: string[] = [];
  if (i.inVictoria === false) fail.push("Property is not in Victoria");
  if (i.nccClass.direct && i.nccClass.value === "not_eligible") fail.push("Direct evidence: premises not Class 1 / Class 2 sole-occupancy unit");
  if (i.ageStatus === "recent_under_5y") fail.push("Direct evidence: relevant ceiling/structure constructed within 5 years of the activity date");
  if (i.noRelevantCeilingDirect) fail.push("Direct evidence: no ceiling with roof cavity/exposed roof above and no storey above");
  if (fail.length) return { outcome: "does_not_appear_eligible", reasons: fail, nextAction: "HI VIC to review evidence and confirm before closing (never auto-closed)", onsite: ONSITE_ALWAYS };

  const review: string[] = [];
  if (i.addressVerified !== true) review.push("Address not verified");
  if (i.inVictoria !== true) review.push("Victorian location not confirmed");
  const strongRes = (i.nccClass.direct && (i.nccClass.value === "class1" || i.nccClass.value === "class2_sou")) || i.residentialLikelihood === "high";
  if (!strongRes) review.push(i.residentialLikelihood === "medium" ? "Residential zoning is an indicator only – NCC class not proven" : "Residential / NCC class not evidenced");
  if (i.ageStatus === "unknown") review.push("Ceiling age (> 5 years) not evidenced");
  if (i.recentExtensionRisk !== "no") review.push(i.recentExtensionRisk === "yes" ? "Recent extension / added storey risk" : "Recent extension / added storey risk unknown");
  if (i.roofForm === "low_slope_flat" || i.roofForm === "mixed") review.push("Flat / low-slope or mixed roof – confirm cavity or exposed roof onsite (not a disqualifier)");
  else if (i.roofForm === "unknown") review.push("Roof form unknown");
  if (i.roofCavityOrExposed !== "likely") review.push("Roof cavity / exposed roof above ceiling not evidenced");
  if (i.storeyAbove !== "no") review.push(i.storeyAbove === "yes" ? "Another storey above part of the ceiling" : "Storey above relevant ceiling unknown");
  if (review.length) return { outcome: "needs_onsite_confirmation", reasons: review, nextAction: "Confirm Gate 1 – arrange onsite confirmation with the assessment visit", onsite: ONSITE_ALWAYS };
  return { outcome: "likely_eligible", reasons: ["All remote Gate 1 checks satisfied – pending onsite insulation, lighting and electrical confirmation"], nextAction: "Confirm Gate 1 – pending onsite insulation, lighting and electrical confirmation", onsite: ONSITE_ALWAYS };
}

/** Maps a set of current facts to the recommendation input. Missing facts = unknown. */
export function gate1InputFromFacts(facts: Fact[], referenceDate: string): Gate1Input {
  const v = (k: string) => facts.find((f) => f.key === k);
  const val = <T,>(k: string, d: T): T => (v(k)?.value ?? d) as T;
  const age = v("age_evidence");
  const ageVal = (age?.value ?? null) as { date: string | null; kind: "historical_imagery_same_footprint" | "direct_record" | "listing_year_built" | "none" } | null;
  const ncc = v("ncc_class_evidence");
  return {
    addressVerified: (v("address_verified")?.value as boolean | undefined) ?? null,
    inVictoria: (v("in_victoria")?.value as boolean | undefined) ?? null,
    residentialLikelihood: val("residential_likelihood", "unknown"),
    nccClass: { value: (ncc?.value as Gate1Input["nccClass"]["value"]) ?? "unknown", direct: ncc?.evidence === "direct" },
    ageStatus: ageVal ? ageStatusFor(ageVal, referenceDate) : "unknown",
    recentExtensionRisk: val("recent_extension_or_added_storey_risk", "unknown"),
    roofForm: val("roof_form", "unknown"),
    roofCavityOrExposed: val("roof_cavity_or_exposed_roof_likelihood", "unknown"),
    storeyAbove: val("another_storey_above_relevant_ceiling", "unknown"),
    noRelevantCeilingDirect: v("no_relevant_ceiling")?.evidence === "direct" && v("no_relevant_ceiling")?.value === true,
  };
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
