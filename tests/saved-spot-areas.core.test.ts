import { describe, expect, test } from "bun:test";
import { groupByArea, type AreaHome } from "../src/lib/saved-spot-areas.core";

// 0.01 deg of latitude is about 1.11 km.
const home = (
  jobId: string,
  latKm: number,
  rankKey: number,
  suburb = "",
  located = true,
): AreaHome => ({
  jobId,
  lat: located ? -37.8 + latKm / 111 : null,
  lng: located ? 145 : null,
  suburb,
  rankKey,
});

describe("groupByArea", () => {
  test("every job appears exactly once", () => {
    const homes = [home("a", 0, 0), home("b", 3, 1), home("c", 40, 2), home("d", 0, 3, "", false)];
    const ids = groupByArea(homes)
      .flatMap((g) => g.jobIds)
      .sort();
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });
  test("two homes 12 km apart are two groups", () => {
    expect(groupByArea([home("a", 0, 0), home("b", 12, 1)]).map((g) => g.jobIds.length)).toEqual([
      1, 1,
    ]);
  });
  test("three homes within 3 km are one group", () => {
    const g = groupByArea([home("a", 0, 0), home("b", 1.5, 1), home("c", 3, 2)]);
    expect(g).toHaveLength(1);
    expect(g[0]!.locationKnown).toBe(true);
  });
  test("a home with no location lands last in Location not known", () => {
    const g = groupByArea([home("x", 0, 0, "", false), home("a", 0, 1), home("b", 1, 2)]);
    const last = g[g.length - 1]!;
    expect(last).toMatchObject({
      heading: "Location not known (1)",
      jobIds: ["x"],
      locationKnown: false,
    });
    expect(g).toHaveLength(2);
  });
  test("heading uses the 3 most common suburbs, ties alphabetical", () => {
    const subs = [
      ...Array(6).fill("Rowville"),
      ...Array(4).fill("Knox"),
      ...Array(2).fill("Ferntree Gully"),
      ...Array(2).fill("Boronia"),
    ];
    const homes = subs.map((s, i) => home(`j${i}`, (i % 3) * 0.5, i, s));
    expect(groupByArea(homes)[0]!.heading).toBe("Rowville · Knox · Boronia (14)");
  });
  test("empty suburbs are ignored; none at all gives Nearby homes", () => {
    expect(groupByArea([home("a", 0, 0), home("b", 1, 1)])[0]!.heading).toBe("Nearby homes (2)");
    expect(groupByArea([home("a", 0, 0, "Rowville"), home("b", 1, 1, "")])[0]!.heading).toBe(
      "Rowville (2)",
    );
  });
  test("single isolated home is a group of 1", () => {
    const g = groupByArea([home("a", 0, 0, "Rowville")]);
    expect(g).toEqual([{ key: "a", heading: "Rowville (1)", jobIds: ["a"], locationKnown: true }]);
  });
  test("bigger groups first, tie by best rankKey; homes keep rank order inside", () => {
    const g = groupByArea([
      home("far", 50, 0),
      home("n1", 0, 5),
      home("n2", 1, 3),
      home("n3", 100, 1),
    ]);
    expect(g[0]!.jobIds).toEqual(["n2", "n1"]);
    expect(g.slice(1).map((x) => x.jobIds[0])).toEqual(["far", "n3"]);
  });
});

// I4: the faster grouping gives exactly what the original greedy gave.
import { distanceM } from "../src/lib/geo.core";
function oldGroups(homes: readonly AreaHome[]): string[][] {
  type L = AreaHome & { lat: number; lng: number };
  let left = homes.filter((h): h is L => h.lat !== null && h.lng !== null);
  const groups: L[][] = [];
  while (left.length) {
    let best: L[] = [];
    for (const c of left) {
      const near = left.filter((h) => h === c || distanceM(c, h) <= 10_000);
      if (near.length > best.length) best = near;
    }
    groups.push([...best].sort((a, b) => a.rankKey - b.rankKey));
    const taken = new Set(best);
    left = left.filter((h) => !taken.has(h));
  }
  groups.sort((a, b) => b.length - a.length || a[0]!.rankKey - b[0]!.rankKey);
  return groups.map((g) => g.map((h) => h.jobId));
}
describe("groupByArea matches the original greedy", () => {
  test("random sets of homes, same groups in the same order", () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let run = 0; run < 40; run++) {
      const n = 5 + Math.floor(rnd() * 120);
      const homes: AreaHome[] = Array.from({ length: n }, (_, i) => ({
        jobId: `j${i}`,
        lat: -37.8 + (rnd() - 0.5) * 0.6,
        lng: 145 + (rnd() - 0.5) * 0.6,
        suburb: `S${Math.floor(rnd() * 5)}`,
        rankKey: i,
      }));
      const got = groupByArea(homes)
        .filter((g) => g.locationKnown)
        .map((g) => g.jobIds);
      expect(got).toEqual(oldGroups(homes));
    }
  });
});
