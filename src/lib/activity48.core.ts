// Official Activity 48 (ceiling insulation) GHG calculation – VEU Specifications 2018 Version 25.0, Part 48.
// Pure, reusable by Step 3 (indicative estimate) and later final quote / VEEC stages.
// Equation 48.1: GHG Eq. Reduction = GHG Savings × Area × Lifetime × Regional Factor (Tables 48.4 / 48.5).
import table from "@/data/veu-location-variables-v25.json";

export const A48_SPEC = {
  version: "25.0",
  sourceUrl: "https://www.energy.vic.gov.au/__data/assets/pdf_file/0041/795488/Victorian-Energy-Upgrades-Specifications-2018-Version-25.pdf",
  sourceSha256: table.source_sha256,
  lifetimeYears: 25,
  regionalFactor: { Metropolitan: 0.98, Regional: 1.04 } as const,
  ghgSavings: { Mild: 0.00576, Cold: 0.00771, Hot: 0.00546 } as const, // tonnes CO2-e / m² / annum
} as const;

export type MetroRegional = "Metropolitan" | "Regional";
export type ClimateRegion = "Mild" | "Cold" | "Hot";
export type LocationVariables = { postcode: string; metropolitan_or_regional: MetroRegional; reticulated_gas: boolean | null; climate_region: ClimateRegion; climate_zone: number | null; source_version: string };

/** Version 25 Table A as extracted and verified from the official PDF (719 rows). The DB table is seeded from this same artefact. */
export const V25_LOCATIONS: ReadonlyMap<string, LocationVariables> = new Map(
  (table.rows as [string, MetroRegional, boolean, ClimateRegion, number][]).map(([p, m, g, c, z]) => [p, { postcode: p, metropolitan_or_regional: m, reticulated_gas: g, climate_region: c, climate_zone: z, source_version: "25.0" }]),
);

/** Exact lookup only – never approximated by postcode range. Unknown postcode => null. */
export function lookupLocation(postcode: string | null | undefined, rows: ReadonlyMap<string, LocationVariables> = V25_LOCATIONS): LocationVariables | null {
  const p = String(postcode ?? "").trim();
  return /^\d{4}$/.test(p) ? rows.get(p) ?? null : null;
}

export type GhgResult = { ghgSavings: number; regionalFactor: number; lifetimeYears: number; areaM2: number; ghgReduction: number; formula: string };
/** Unrounded Equation 48.1 result (tonnes CO2-e). */
export function ghgEquivalentReduction(areaM2: number, loc: Pick<LocationVariables, "metropolitan_or_regional" | "climate_region">): GhgResult {
  const ghgSavings = A48_SPEC.ghgSavings[loc.climate_region];
  const regionalFactor = A48_SPEC.regionalFactor[loc.metropolitan_or_regional];
  const lifetimeYears = A48_SPEC.lifetimeYears;
  const ghgReduction = ghgSavings * areaM2 * lifetimeYears * regionalFactor;
  return { ghgSavings, regionalFactor, lifetimeYears, areaM2, ghgReduction, formula: `${ghgSavings} × ${areaM2} × ${lifetimeYears} × ${regionalFactor}` };
}
