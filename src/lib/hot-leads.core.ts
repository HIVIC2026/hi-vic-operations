import centroids from "@/data/vic-postcode-centroids.json";
import { regionForPostcode, regionsForDeclaredAreas, type RegionId } from "./coverage-regions.core";

export const HOT_LEAD_BLOCKED = true;
export const HOT_SUBJECT = "Your ceiling insulation quote — save your spot";
export const HOT_EXCLUDE = /\b(?:test|qa|jo lowe|delete me|sam taylor|alex spark)\b/i;
export type Trade = { id: string; name: string; kind: "installer" | "rec"; areas?: string[] | null; origin?: { latitude?: number | null; longitude?: number | null; postcode?: string | null } | null; radius?: number | null };

const coord = (postcode: string | null) => (postcode && centroids[postcode as keyof typeof centroids]) || null;
function distance(a: readonly number[], b: readonly number[]) {
  const rad = Math.PI / 180, dLat = ((b[0] ?? 0) - (a[0] ?? 0)) * rad, dLon = ((b[1] ?? 0) - (a[1] ?? 0)) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] ?? 0) * rad) * Math.cos((b[0] ?? 0) * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function tradeCovers(trade: Trade, postcode: string | null, region: RegionId): boolean {
  if (!postcode || region === "unknown") return false;
  const target = coord(postcode);
  const origin = trade.origin;
  if (target && origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude) && trade.radius && trade.radius > 0) {
    return trade.radius === 9999 || distance([Number(origin.latitude), Number(origin.longitude)], target) <= trade.radius;
  }
  // Enquiries can contain a postcode + radius instead of a resolved place. Never treat a radius as a whole region.
  for (const label of trade.areas ?? []) {
    const match = label.match(/\bVIC\s+(\d{4})\s+(\d+)\s*km\s*radius/i);
    if (match && target && coord(match[1] ?? null)) {
      const start = coord(match[1] ?? null);
      if (start && distance(start, target) <= Number(match[2])) return true;
    }
  }
  return regionsForDeclaredAreas((trade.areas ?? []).filter((label) => !/\bVIC\s+\d{4}\s+\d+\s*km/i.test(label))).includes(region);
}
export function hotRegion(postcode: string | null): string {
  const r = regionForPostcode(postcode);
  if (r.startsWith("mel_")) return "Melbourne metro";
  if (r === "mornington") return "Mornington Peninsula";
  if (r === "geelong") return "Geelong";
  if (r === "hume") return "Goulburn & Hume";
  if (r === "gippsland") return "Gippsland";
  if (r === "bendigo_macedon") return "Bendigo / Loddon";
  return ["ballarat", "wimmera_mallee", "south_west"].includes(r) ? "Western Victoria" : "Other Victoria";
}
export function hotCoverage(postcode: string | null, trades: Trade[]) {
  const region = regionForPostcode(postcode);
  const matches = trades.filter((t) => tradeCovers(t, postcode, region));
  return { installers: [...new Set(matches.filter((t) => t.kind === "installer").map((t) => t.name))], electricians: [...new Set(matches.filter((t) => t.kind === "rec").map((t) => t.name))], checkCoverage: postcode === "3340" || postcode === "3434" };
}