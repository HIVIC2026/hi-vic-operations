import { expect, test } from "bun:test";
import {
  insulationChip, lastHeardChip, matchesChips, pageOf, parseList, priorityScore, rankByPriority, regionChip, sizeChip, sortRows, sourceChip, INSULATION_CHIPS,
} from "../src/lib/office-filters.core";

const NOW = Date.parse("2026-10-24T03:00:00Z"); // 2pm Melbourne

test("chips: insulation, size bands, last heard, source", () => {
  expect(insulationChip("none")).toBe("no");
  expect(insulationChip("present")).toBe("some");
  expect(insulationChip(null)).toBe("not_sure");
  expect(sizeChip(99)).toBe("under_100");
  expect(sizeChip(100)).toBe("100_150");
  expect(sizeChip(151)).toBe("over_150");
  expect(sizeChip(null)).toBe("none");
  expect(lastHeardChip("2026-10-23T22:00:00Z", NOW)).toBe("today"); // 9am Melbourne 24 Oct
  expect(lastHeardChip("2026-10-20T00:00:00Z", NOW)).toBe("week");
  expect(lastHeardChip("2026-09-01T00:00:00Z", NOW)).toBe("older");
  expect(lastHeardChip(null, NOW)).toBe("never");
  expect(sourceChip({ source: "base44", channel: "hivic_sourced" })).toBe("website");
  expect(sourceChip({ source: "portal", channel: "hivic_sourced" })).toBe("phone");
  expect(sourceChip({ source: "installer_portal", channel: "installer_sourced" })).toBe("installer");
});

test("region chip uses the Partners › Coverage postcode regions", () => {
  expect(regionChip("3133")).toBe("east"); // Vermont South
  expect(regionChip("3168")).toBe("south_east"); // Clayton
  expect(regionChip("3930")).toBe("south_east"); // Mornington Peninsula
  expect(regionChip("3076")).toBe("north"); // Epping
  expect(regionChip("3030")).toBe("west"); // Werribee
  expect(regionChip("3000")).toBe("inner");
  expect(regionChip("3550")).toBe("regional"); // Bendigo
  expect(regionChip("")).toBeNull();
});

test("multi-select: OR inside a column, AND across columns; empty column never filters", () => {
  const row = { insulation: "no" as const, size: "100_150" as const, region: "east" as const, source: "website" as const, heard: "never" as const, installer: null, suburb: "Box Hill" };
  expect(matchesChips(row, {})).toBe(true);
  expect(matchesChips(row, { insulation: ["no", "some"] })).toBe(true);
  expect(matchesChips(row, { insulation: ["some"] })).toBe(false);
  expect(matchesChips(row, { insulation: ["no"], region: ["west"] })).toBe(false);
  expect(matchesChips(row, { installer: ["none"] })).toBe(true);
  expect(matchesChips(row, { suburb: "box" })).toBe(true);
  expect(matchesChips(row, { suburb: "clay" })).toBe(false);
});

test("priority: no insulation beats size beats recent contact beats covered area", () => {
  const base = { areaM2: null, lastHeardAt: null, covered: false, createdAt: "2026-10-01T00:00:00Z" };
  expect(priorityScore({ ...base, insulation: "no" }, NOW)).toBe(8);
  expect(priorityScore({ ...base, insulation: "some", areaM2: 120, lastHeardAt: "2026-10-23T00:00:00Z", covered: true }, NOW)).toBe(7);
  const ranked = rankByPriority([
    { id: "a", ...base, insulation: "some" as const, covered: true },
    { id: "b", ...base, insulation: "no" as const },
    { id: "c", ...base, insulation: "some" as const, areaM2: 130 },
    { id: "d", ...base, insulation: "some" as const, lastHeardAt: "2026-10-22T00:00:00Z" },
    { id: "e", ...base, insulation: "no" as const, areaM2: 110, createdAt: "2026-10-02T00:00:00Z" },
  ], NOW);
  expect(ranked.map((r) => [r.id, r.priority])).toEqual([["e", 1], ["b", 2], ["c", 3], ["d", 4], ["a", 5]]);
});

test("sorting keeps nulls last and is stable; paging clamps", () => {
  const rows = [{ id: "1", n: 3 }, { id: "2", n: null }, { id: "3", n: 1 }];
  expect(sortRows(rows, "n", "asc").map((r) => r.id)).toEqual(["3", "1", "2"]);
  expect(sortRows(rows, "n", "desc").map((r) => r.id)).toEqual(["1", "3", "2"]);
  expect(pageOf([1, 2, 3], 9, 2)).toEqual({ rows: [3], page: 2, totalPages: 2, total: 3, pageSize: 2 });
  expect(parseList("no,bogus,some,no", INSULATION_CHIPS)).toEqual(["no", "some"]);
});
