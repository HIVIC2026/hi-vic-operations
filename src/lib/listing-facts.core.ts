// Listing facts for the nightly listing check (saved spots by area, Task 7). PURE: no I/O.
import type { SpotBand } from "./saved-spot-rank.core";
import { BAND_ORDER } from "./saved-spot-rank.core";

export type ListingPropertyType = "house" | "townhouse" | "unit";

export type ListingResult = {
  jobId: string;
  status: "found" | "not found";
  url: string | null;
  source: string | null;
  floorAreaM2: number | null;
  landM2: number | null;
  storeys: number | null;
  beds: number | null;
  yearBuilt: number | null;
  hasFloorPlan: boolean | null;
  propertyType: string | null;
  roof: string | null;
};

export const MAX_LISTING_RESULTS = 100;

const KEYS = [
  "jobId",
  "status",
  "url",
  "source",
  "floorAreaM2",
  "landM2",
  "storeys",
  "beds",
  "yearBuilt",
  "hasFloorPlan",
  "propertyType",
  "roof",
] as const;
const strOrNull = (v: unknown) => v === null || typeof v === "string";
/** The listing link comes from a task reading web pages: only a plain http(s) address (or none) is kept. */
const webUrlOrNull = (v: unknown) =>
  v === null || (typeof v === "string" && /^https?:\/\/\S+$/i.test(v));
const numOrNull = (v: unknown) =>
  v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

/** Exactly the ListingResult keys, each the right type; any extra key makes it invalid. */
export function listingResultValid(x: unknown): x is ListingResult {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== KEYS.length || !KEYS.every((k) => k in o)) return false;
  return (
    typeof o["jobId"] === "string" &&
    o["jobId"].length > 0 &&
    (o["status"] === "found" || o["status"] === "not found") &&
    webUrlOrNull(o["url"]) &&
    strOrNull(o["source"]) &&
    strOrNull(o["propertyType"]) &&
    strOrNull(o["roof"]) &&
    numOrNull(o["floorAreaM2"]) &&
    numOrNull(o["landM2"]) &&
    numOrNull(o["storeys"]) &&
    numOrNull(o["beds"]) &&
    numOrNull(o["yearBuilt"]) &&
    (o["hasFloorPlan"] === null || typeof o["hasFloorPlan"] === "boolean")
  );
}

/** Listing wording → house | townhouse | unit, else null (avoids false "Listing says…" mismatches). */
export function normalisePropertyType(t: string | null | undefined): ListingPropertyType | null {
  const s = (t ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/semi|duplex|terrace|villa|town ?house|town ?home/.test(s)) return "townhouse";
  if (/apartment|flat|unit|studio/.test(s)) return "unit";
  if (/^(house|home|freestanding|free-standing|detached)\b/.test(s) || s === "house")
    return "house";
  return null;
}

/** The value stored on the property: the result minus jobId, with the type normalised. */
export function listingFactValue(
  r: ListingResult,
): Omit<ListingResult, "propertyType"> & { propertyType: ListingPropertyType | null } {
  return { ...r, propertyType: normalisePropertyType(r.propertyType) };
}

export type QueueItem = { jobId: string; savedAt: string; band: SpotBand };
const DAY_MS = 86_400_000;

/** Spots saved in the last 2 days first (newest first); then Best → Weak; inside a band, oldest saved first. */
export function orderListingQueue<T extends QueueItem>(items: T[], nowMs: number): T[] {
  const at = (i: T) => Date.parse(i.savedAt) || 0;
  const recent = (i: T) => nowMs - at(i) < 2 * DAY_MS;
  return [...items].sort((a, b) => {
    const ra = recent(a),
      rb = recent(b);
    if (ra !== rb) return ra ? -1 : 1;
    if (ra) return at(b) - at(a);
    return BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band) || at(a) - at(b);
  });
}
