// Night run 25 Oct 2026 finding: trade photo uploads were refused on every new job ("We don't have this property's
// location on file yet") because only the retired property lookup ever wrote the `coordinates` fact. The photo check now
// fills it once from the same address search Add a job uses (Google Places via the website). PURE: the match rule.
import type { AddressDetails } from "./whatif-location";

export type PropertyAddress = { address_line: string | null; suburb: string | null; state: string | null; postcode: string | null };

/** The search text for the property, or null when the address is too thin to look up safely. */
export function propertySearchText(p: PropertyAddress): string | null {
  const line = (p.address_line ?? "").trim(), postcode = (p.postcode ?? "").trim();
  if (!line || !/^\d{4}$/.test(postcode)) return null;
  return [line, [p.suburb, p.state ?? "VIC", postcode].filter(Boolean).join(" ")].join(", ");
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** [lng, lat] when the looked-up address is the SAME place (same postcode, same suburb when both are known, real AU
 *  coordinates); otherwise null — never a guessed point. */
export function coordinatesFromLookup(p: PropertyAddress, d: AddressDetails | null): [number, number] | null {
  if (!d || d.latitude == null || d.longitude == null) return null;
  if (!d.postcode || d.postcode.trim() !== (p.postcode ?? "").trim()) return null;
  if (p.suburb && d.suburb && norm(p.suburb) !== norm(d.suburb)) return null;
  const lat = d.latitude, lng = d.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat > -9 || lat < -44 || lng < 112 || lng > 154) return null;
  return [lng, lat];
}
