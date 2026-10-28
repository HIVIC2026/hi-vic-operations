import { describe, expect, test } from "bun:test";
import centroids from "../src/data/vic-postcode-centroids.json";
import { proposeDeclaredCoverage } from "../src/lib/declared-coverage-proposal.core";

// Jo 29 Oct 2026: Derrimut (3026) was placed near Point Cook, so coverage from Derrimut missed the western suburbs.
const km = (a: number[], b: number[]) => {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b[0]! - a[0]!) / 2) ** 2 + Math.cos(r(a[0]!)) * Math.cos(r(b[0]!)) * Math.sin(r(b[1]! - a[1]!) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};

describe("Derrimut postcode location", () => {
  const pts = centroids as Record<string, number[]>;
  test("3026 sits in Derrimut, near Sunshine West and Deer Park", () => {
    expect(km(pts["3026"]!, [-37.7955, 144.7705])).toBeLessThan(3);
    expect(km(pts["3026"]!, pts["3023"]!)).toBeLessThan(8); // Deer Park / Burnside / Cairnlea
    expect(km(pts["3026"]!, pts["3012"]!)).toBeLessThan(15); // Brooklyn / Kingsville area
  });
  test("25 km from Derrimut includes Footscray (3011)", () => {
    expect(proposeDeclaredCoverage("29 Upton Cir, Derrimut VIC 3026", 25).postcodes).toContain("3011");
  });
});
