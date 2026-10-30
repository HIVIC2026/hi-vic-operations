// Area batches (A48 batch 2). PURE: no I/O. Owner answers and the roof fact come in as plain values.
import { distanceM } from "./geo.core";

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export type LikelyFacts = {
  propertyType: string | null;
  topFloor: string | null;
  overFiveYears: string | null;
  insulation: string | null;
  insulationThickness: string | null;
  roofForm: string | null;
};

/** Most likely eligible: house/townhouse (or top-floor unit), over 5 years, no insulation or "thin", roof not fully flat (unknown is fine). */
export function likelyEligible(f: LikelyFacts): boolean {
  const type = norm(f.propertyType);
  const homeOk = type === "house" || type === "townhouse" || (type === "apartment" && norm(f.topFloor) === "yes");
  if (!homeOk) return false;
  if (norm(f.overFiveYears) !== "yes") return false;
  if (norm(f.roofForm) === "low_slope_flat") return false;
  const ins = norm(f.insulation);
  return ins === "none" || (ins === "present" && norm(f.insulationThickness) === "thin");
}

export type BatchHome = { jobId: string; lat: number; lng: number; postcode: string; spotSavedAt: string };

const RADIUS_M = 10_000;
const MAX_BATCH = 10;
const MIN_BATCH = 8;
const SMALL_BATCH_WAIT_MS = 14 * 86_400_000;

/**
 * Densest-first greedy. Each home is tried as a centre; its batch is the nearest homes within 10 km of it
 * (centre included, capped at 10). A batch needs 8+ homes, or fewer only if every home has waited 14+ days.
 * The largest valid batch is taken, its homes are removed, repeat. A home is never in two batches.
 */
export function suggestBatches(homes: BatchHome[], nowIso: string): BatchHome[][] {
  const now = Date.parse(nowIso);
  const waitedEnough = (h: BatchHome) => now - Date.parse(h.spotSavedAt) >= SMALL_BATCH_WAIT_MS;
  const valid = (b: BatchHome[]) => b.length >= MIN_BATCH || (b.length > 0 && b.every(waitedEnough));
  let left = [...homes];
  const out: BatchHome[][] = [];
  for (;;) {
    let best: BatchHome[] | null = null;
    for (const c of left) {
      const batch = left
        .map((h) => ({ h, d: h === c ? 0 : distanceM(c, h) }))
        .filter((x) => x.d <= RADIUS_M)
        .sort((a, b) => a.d - b.d)
        .slice(0, MAX_BATCH)
        .map((x) => x.h);
      if (valid(batch) && (!best || batch.length > best.length)) best = batch;
    }
    if (!best) return out;
    out.push(best);
    const taken = new Set(best);
    left = left.filter((h) => !taken.has(h));
  }
}

/** Garage, carport, car port or shed as a whole word, any case ("Shedding room" is not one). */
export const excludedAreaName = (name: string): boolean => /\b(garage|car\s?port|shed)\b/i.test(name);
