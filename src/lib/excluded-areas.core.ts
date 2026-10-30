// Garage / carport / shed ceiling areas never count toward eligible m² (quote, VEEC and claim facts). PURE.
// Jo 30 Oct 2026: the area is left out of every total and recorded once per job as an `excluded_area` event.

export const EXCLUDED_AREA_EVENT = "excluded_area";

/** Garage, carport, car port or shed as a whole word, any case ("Shedding room" is not one). */
export const excludedAreaName = (name: string): boolean => /\b(garage|car\s?port|shed)\b/i.test(name);

export type ExcludedArea = { name: string; m2: number | null };

export function splitEligibleAreas<T>(areas: readonly T[], nameOf: (a: T) => string | null | undefined): { eligible: T[]; excluded: T[] } {
  const eligible: T[] = [], excluded: T[] = [];
  for (const a of areas) (excludedAreaName(nameOf(a) ?? "") ? excluded : eligible).push(a);
  return { eligible, excluded };
}

const key = (n: string) => n.trim().replace(/\s+/g, " ").toLowerCase();

/** The excluded areas not yet recorded for the job (by name, once per area; repeats in the list collapse to the first). */
export function newExcludedAreas(found: readonly ExcludedArea[], alreadyRecorded: readonly string[]): ExcludedArea[] {
  const seen = new Set(alreadyRecorded.map(key));
  const out: ExcludedArea[] = [];
  for (const f of found) { const k = key(f.name); if (!k || seen.has(k)) continue; seen.add(k); out.push({ name: f.name.trim(), m2: f.m2 }); }
  return out;
}
