import centroids from "@/data/vic-postcode-centroids.json";

type CoverageProposal =
  | { postcodes: string[]; summary: string; reason: null }
  | { postcodes: null; summary: null; reason: string };

/** Office suggestions only; never establishes verified coverage or applies exclusions. */
export function proposeDeclaredCoverage(origin: string | null | undefined, radiusKm: number | null | undefined): CoverageProposal {
  if (radiusKm == null || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return { postcodes: null, summary: null, reason: "No travel distance" };
  }
  if (radiusKm === 9999) return { postcodes: ["3*"], summary: "All Victorian postcodes (3xxx)", reason: null };

  const points: Record<string, number[]> = centroids;
  const postcode = origin?.match(/\b3\d{3}\b/g)?.find((code) => points[code]);
  const point = postcode ? points[postcode] : undefined;
  if (!postcode || !point) return { postcodes: null, summary: null, reason: "No postcode in their address" };

  const radians = (degrees: number) => degrees * Math.PI / 180;
  const postcodes = Object.entries(points).filter(([code, target]) => {
    if (!/^3\d{3}$/.test(code)) return false;
    const a = Math.sin(radians(target[0] - point[0]) / 2) ** 2
      + Math.cos(radians(point[0])) * Math.cos(radians(target[0])) * Math.sin(radians(target[1] - point[1]) / 2) ** 2;
    const distanceKm = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    return distanceKm <= radiusKm;
  }).map(([code]) => code).sort();
  return { postcodes, summary: `${postcodes.length} postcodes within ${radiusKm} km of ${postcode}`, reason: null };
}