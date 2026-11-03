// Saved spots ranked best to worst (design: 2026-11-03-saved-spots-by-area). PURE: no I/O.
// Band first, then score inside the band. Jo's desk check always beats the AI photo check.
export type SpotBand = "best" | "good" | "ok" | "weak";
export const BAND_ORDER: readonly SpotBand[] = ["best", "good", "ok", "weak"];

/** lead_campaign_responses.desk_check_status values; the first three are Jo's own outcomes. */
export type DeskCheckStatus =
  "looks_eligible" | "not_eligible" | "needs_onsite_check" | "pending" | "not_needed";

export type SpotFacts = {
  insulation: "none" | "present" | "unknown" | null;
  insulationDetail: "thin" | "loose_fill" | "patchy" | "under_r2" | "thicker" | null;
  deskCheck: DeskCheckStatus | null;
  aiPhoto: "none" | "under_r2" | "over_r2" | "cant_tell" | null;
  propertyType: "house" | "townhouse" | "apartment" | null;
  topFloor: "yes" | "no" | null;
  areaM2: number | null;
  /** Google Solar roof ground area (`solar_summary.roof_ground_area_m2`), m². */
  roofGroundM2: number | null;
  /** Google Solar building ground footprint (`building_ground_footprint.m2`), m². */
  footprintM2: number | null;
  /** Floor area from the listing check, m² (only when a listing was found). */
  listingFloorM2: number | null;
  roofForm: "pitched" | "low_slope_flat" | "mixed" | null;
  complexRoof: boolean;
  tapsHatch: "yes" | "no" | "not_sure" | null;
  tapsRoof: "sloped" | "flat" | "some" | "not_sure" | null;
  listing: {
    found: boolean;
    floorPlan: boolean;
    type: string | null;
    storeys: number | null;
    checked: boolean;
  } | null;
  lifeSupport: boolean;
  streetKnown: boolean;
  spotSavedAt: string;
};

// Weights: tune here only.
export const W = {
  house: 30,
  townhouse: 20,
  apartment: 0,
  areaMax: 40,
  areaPerPoint: 5, // points = min(areaMax, m2 / areaPerPoint)
  floorPlan: 15,
  listingFound: 5,
  pitchedRoof: 10,
  flatRoof: -20,
  hatchYesRoofSloped: 10,
  tapsRoofFlat: -20,
  listingMismatch: -15,
  listingStoreys2: -10,
  complexRoof: -3,
  perDayWaiting: 0.1,
} as const;

/** Allowance for eaves when working from the roof seen from above. */
const EAVES_FACTOR = 0.85;
const CHECK_SIZE_DIFF = 0.3;

export type EstimatedCeiling = { m2: number; source: "listing" | "above" };
const positive = (v: number | null): v is number => v != null && Number.isFinite(v) && v > 0;
const round5 = (v: number) => Math.round(v / 5) * 5;

/** Best estimate of the ceiling size: listing floor area (single storey or unknown), else roof from above × 0.85. */
export function estimatedCeiling(f: SpotFacts): EstimatedCeiling | null {
  const storeys = f.listing?.found ? f.listing.storeys : null;
  if (positive(f.listingFloorM2) && (storeys == null || storeys <= 1))
    return { m2: round5(f.listingFloorM2), source: "listing" };
  const above = positive(f.roofGroundM2) ? f.roofGroundM2 : positive(f.footprintM2) ? f.footprintM2 : null;
  return above != null ? { m2: round5(above * EAVES_FACTOR), source: "above" } : null;
}

function ownerDiffers(f: SpotFacts, est: EstimatedCeiling | null): boolean {
  return est != null && positive(f.areaM2) && Math.abs(est.m2 - f.areaM2) / f.areaM2 > CHECK_SIZE_DIFF;
}

const DAY_MS = 86_400_000;
/** Jo's own desk-check outcomes (launch-campaign.core DeskCheckOutcome): any of these means the AI is not used. */
const JO_DECIDED = new Set(["looks_eligible", "not_eligible", "needs_onsite_check"]);
const joDecided = (f: SpotFacts) => f.deskCheck != null && JO_DECIDED.has(f.deskCheck);
const THIN_DETAILS = new Set(["thin", "loose_fill", "patchy", "under_r2"]);

export function spotBand(f: SpotFacts): SpotBand {
  if (f.deskCheck === "looks_eligible") return "best";
  if (f.deskCheck === "not_eligible") return "weak";
  // needs_onsite_check: Jo has looked, so the AI is ignored and the owner's answers decide.
  if (!joDecided(f)) {
    if (f.aiPhoto === "none" || f.aiPhoto === "under_r2") return "best";
    if (f.aiPhoto === "over_r2") return "weak";
  }
  if (f.propertyType === "apartment" && f.topFloor === "no") return "weak";
  if (f.insulation === "none") return "good";
  if (f.insulation === "unknown") return "ok";
  if (f.insulation === "present")
    return f.insulationDetail && THIN_DETAILS.has(f.insulationDetail) ? "ok" : "weak";
  return "weak";
}

const norm = (t: string) => {
  const s = t.trim().toLowerCase();
  return s === "unit" ? "apartment" : s;
};

function listingMismatch(f: SpotFacts): string | null {
  const l = f.listing;
  if (!l?.found || !l.type || !f.propertyType) return null;
  return norm(l.type) === norm(f.propertyType) ? null : l.type.trim().toLowerCase();
}

export function spotScore(f: SpotFacts, nowMs: number): number {
  let s = 0;
  s +=
    f.propertyType === "house"
      ? W.house
      : f.propertyType === "townhouse"
        ? W.townhouse
        : W.apartment;
  const size = estimatedCeiling(f)?.m2 ?? f.areaM2;
  if (size != null && size > 0) s += Math.min(W.areaMax, size / W.areaPerPoint);
  if (f.listing?.floorPlan) s += W.floorPlan;
  else if (f.listing?.found) s += W.listingFound;
  if (f.roofForm === "pitched") s += W.pitchedRoof;
  else if (f.roofForm === "low_slope_flat") s += W.flatRoof;
  if (f.tapsHatch === "yes" && f.tapsRoof === "sloped") s += W.hatchYesRoofSloped;
  if (f.tapsRoof === "flat") s += W.tapsRoofFlat;
  if (listingMismatch(f)) s += W.listingMismatch;
  if (f.listing?.found && (f.listing.storeys ?? 0) >= 2) s += W.listingStoreys2;
  if (f.complexRoof) s += W.complexRoof;
  const saved = Date.parse(f.spotSavedAt);
  if (Number.isFinite(saved)) s += Math.max(0, (nowMs - saved) / DAY_MS) * W.perDayWaiting;
  return s;
}

const DETAIL_LABEL: Record<NonNullable<SpotFacts["insulationDetail"]>, string> = {
  thin: "thin insulation",
  loose_fill: "loose-fill insulation",
  patchy: "patchy insulation",
  under_r2: "under R2",
  thicker: "thicker insulation",
};
const ROOF_LABEL = {
  pitched: "pitched roof",
  low_slope_flat: "flat roof",
  mixed: "mixed roof",
} as const;

export function spotReason(f: SpotFacts): string {
  const parts: string[] = [];
  if (f.insulation === "none") parts.push("No insulation");
  else if (f.insulation === "unknown") parts.push("Not sure about insulation");
  else if (f.insulation === "present")
    parts.push(f.insulationDetail ? DETAIL_LABEL[f.insulationDetail] : "Has insulation");
  if (f.propertyType) parts.push(f.propertyType);
  const est = estimatedCeiling(f);
  const size = est?.m2 ?? f.areaM2;
  if (size != null && size > 0) parts.push(`~${Math.round(size)} m²`);
  if (ownerDiffers(f, est)) parts.push(`owner said ${Math.round(f.areaM2 as number)} m²`);
  if (f.listing?.floorPlan) parts.push("floor plan found");
  if (f.roofForm) parts.push(ROOF_LABEL[f.roofForm]);
  const first = parts[0];
  if (first && f.insulation === "present")
    parts[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return parts.join(" · ");
}

export function spotTags(f: SpotFacts): string[] {
  const tags: string[] = [];
  if (f.lifeSupport) tags.push("Life support");
  if (!f.streetKnown) tags.push("No street address");
  const mismatch = listingMismatch(f);
  if (mismatch) tags.push(`Listing says: ${mismatch}`);
  else if (f.listing?.found && (f.listing.storeys ?? 0) >= 2)
    tags.push(`Listing says: ${f.listing.storeys} storeys`);
  if (f.deskCheck === "not_eligible") tags.push("Jo: not eligible");
  if (!joDecided(f)) {
    if (f.aiPhoto === "none" || f.aiPhoto === "under_r2") tags.push("AI: confirm");
    else if (f.aiPhoto === "over_r2") tags.push("AI: looks over R2 — confirm");
  }
  if (((f.listing?.found && (f.listing.storeys ?? 0) >= 2)) || ownerDiffers(f, estimatedCeiling(f)))
    tags.push("Check size");
  if (f.streetKnown && (!f.listing || !f.listing.checked)) tags.push("Not checked yet");
  return tags;
}

/** Maps the stored desk-check reason text to a detail; anything else (incl. owner-declared) → null. */
export function insulationDetailFromDesk(reason: string | null): SpotFacts["insulationDetail"] {
  if (!reason) return null;
  const r = reason.toLowerCase();
  if (r.includes("thin/loose-fill") || r.includes("loose-fill insulation only"))
    return "loose_fill";
  if (r.includes("less than r2")) return "under_r2";
  return null;
}
