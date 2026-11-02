import { describe, expect, test } from "bun:test";
import { excludedAreaName, likelyEligible, suggestBatches, type BatchHome } from "../src/lib/area-batch.core";

const base = { propertyType: "house", topFloor: "", overFiveYears: "yes", insulation: "none", insulationThickness: "unknown", roofForm: "pitched" };
const f = (o: Partial<typeof base> = {}) => ({ ...base, ...o });

describe("likelyEligible", () => {
  test("house, over 5 years, no insulation, pitched roof", () => expect(likelyEligible(f())).toBe(true));
  test("townhouse counts", () => expect(likelyEligible(f({ propertyType: "townhouse" }))).toBe(true));
  test("top-floor apartment with thin insulation", () =>
    expect(likelyEligible(f({ propertyType: "apartment", topFloor: "yes", insulation: "present", insulationThickness: "thin" }))).toBe(true));
  test("unknown or mixed roof still counts", () => {
    expect(likelyEligible(f({ roofForm: "unknown" }))).toBe(true);
    expect(likelyEligible(f({ roofForm: "mixed" }))).toBe(true);
    expect(likelyEligible(f({ roofForm: null }))).toBe(true);
  });
  test("fully flat roof is out", () => expect(likelyEligible(f({ roofForm: "low_slope_flat" }))).toBe(false));
  test("over five years no / blank / unknown is out", () => {
    expect(likelyEligible(f({ overFiveYears: "no" }))).toBe(false);
    expect(likelyEligible(f({ overFiveYears: "" }))).toBe(false);
    expect(likelyEligible(f({ overFiveYears: null }))).toBe(false);
    expect(likelyEligible(f({ overFiveYears: "unknown" }))).toBe(false);
  });
  test("insulation present without thin is out", () => {
    for (const t of ["hand", "thicker", "unknown", null]) expect(likelyEligible(f({ insulation: "present", insulationThickness: t as string | null }))).toBe(false);
  });
  test("unknown insulation is out", () => expect(likelyEligible(f({ insulation: "unknown" }))).toBe(false));
  test("apartment not on top floor is out", () => {
    expect(likelyEligible(f({ propertyType: "apartment", topFloor: "no" }))).toBe(false);
    expect(likelyEligible(f({ propertyType: "apartment", topFloor: "" }))).toBe(false);
  });
  test("property type blank / other / unknown is out", () => {
    for (const p of ["", null, "other", "unknown"]) expect(likelyEligible(f({ propertyType: p }))).toBe(false);
  });
  test("case and spaces are ignored", () => expect(likelyEligible(f({ propertyType: " House ", overFiveYears: "YES" }))).toBe(true));
});

const NOW = "2026-10-30T00:00:00.000Z";
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86400000).toISOString();
// 0.001 deg lat ~ 111 m
const mk = (id: string, northKm: number, eastKm: number, waited: number): BatchHome => ({
  jobId: id, lat: -37.8 + northKm / 111.19, lng: 145 + eastKm / (111.19 * Math.cos(37.8 * Math.PI / 180)), postcode: "3000", spotSavedAt: daysAgo(waited),
});

describe("suggestBatches", () => {
  test("12 homes close together make one batch of 10 and leave 2", () => {
    const homes = Array.from({ length: 12 }, (_, i) => mk(`j${i}`, i * 0.5, 0, 1));
    const r = suggestBatches(homes, NOW);
    expect(r.length).toBe(1);
    expect(r[0]!.length).toBe(10);
    expect(new Set(r[0]!.map((h) => h.jobId)).size).toBe(10);
  });
  test("5 homes waiting 10 days make no batch", () =>
    expect(suggestBatches(Array.from({ length: 5 }, (_, i) => mk(`j${i}`, i, 0, 10)), NOW)).toEqual([]));
  test("the same 5 waiting 15 days make one batch", () => {
    const r = suggestBatches(Array.from({ length: 5 }, (_, i) => mk(`j${i}`, i, 0, 15)), NOW);
    expect(r.length).toBe(1);
    expect(r[0]!.length).toBe(5);
  });
  test("a small batch needs every home to have waited 14 days", () => {
    const homes = [...Array.from({ length: 4 }, (_, i) => mk(`j${i}`, i, 0, 20)), mk("late", 4, 0, 3)];
    expect(suggestBatches(homes, NOW)).toEqual([]);
  });
  test("exactly 14 days counts", () =>
    expect(suggestBatches(Array.from({ length: 3 }, (_, i) => mk(`j${i}`, i, 0, 14)), NOW).length).toBe(1));
  test("homes 12 km apart are never together", () => {
    const a = Array.from({ length: 8 }, (_, i) => mk(`a${i}`, i * 0.2, 0, 1));
    const b = Array.from({ length: 8 }, (_, i) => mk(`b${i}`, 12 + i * 0.2, 0, 1));
    const r = suggestBatches([...a, ...b], NOW);
    expect(r.length).toBe(2);
    for (const batch of r) expect(new Set(batch.map((h) => h.jobId[0])).size).toBe(1);
  });
  test("a home is in at most one batch", () => {
    const homes = Array.from({ length: 25 }, (_, i) => mk(`j${i}`, (i % 5) * 0.5, Math.floor(i / 5) * 0.5, 1));
    const ids = suggestBatches(homes, NOW).flat().map((h) => h.jobId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(20);
  });
  test("no homes, no batches", () => expect(suggestBatches([], NOW)).toEqual([]));
  test("one home that has waited 14+ days → exactly one batch of 1", () => {
    const r = suggestBatches([mk("solo", 0, 0, 20)], NOW);
    expect(r.length).toBe(1);
    expect(r[0]!.map((h) => h.jobId)).toEqual(["solo"]);
  });
  test("a home with an unreadable spot-saved date is never put in a small batch (and nothing throws)", () => {
    const bad = { ...mk("bad", 0, 0, 0), spotSavedAt: "not a date" };
    expect(suggestBatches([bad], NOW)).toEqual([]);
    const waited = Array.from({ length: 3 }, (_, i) => mk(`w${i}`, i * 0.5, 0, 20));
    const ids = suggestBatches([...waited, { ...bad, lat: waited[1]!.lat }], NOW).flat().map((h) => h.jobId);
    expect(ids).not.toContain("bad");
  });
});

describe("excludedAreaName", () => {
  test.each(["Garage", "double carport", "Shed 1", "Car port", "the SHED", "Garage/workshop"])("%s is excluded", (n) => expect(excludedAreaName(n)).toBe(true));
  test.each(["Shedding room", "Lounge", "", "Garaged"])("%s is not excluded", (n) => expect(excludedAreaName(n)).toBe(false));
});

// ---- Task 6 (Jo 2 Nov 2026): To release shows batch status; tick to Send ------------------------------------------------
describe("To release: batch status per row", async () => {
  const { AREA_BATCH_MAX_HOMES, batchRowState, batchRowLine, tickSendBlocker } = await import("../src/lib/area-batch.core");
  const ev = (event_type: string, batch_id: string, created_at: string, extra: Record<string, unknown> = {}) => ({ event_type, created_at, details: { batch_id, ...extra } });
  const sent = (b = "b1", at = "2026-11-01T01:00:00Z") => ev("area_batch_sent", b, at, { installer_name: "RAPID INSULATION" });
  test("texted, no answer → waiting for owner with the installer's name in normal case", () => {
    const s = batchRowState([sent()]);
    expect(s).toEqual({ kind: "waiting", installerName: "Rapid Insulation" });
    expect(batchRowLine(s, "WAYNE WILSON")).toBe("Waiting for owner (sent for Rapid Insulation)");
  });
  test("said yes before the batch closes → said yes", () => {
    const s = batchRowState([sent(), ev("quick_taps_answered", "b1", "2026-11-01T02:00:00Z", { outcome: "pass" })]);
    expect(s).toEqual({ kind: "said_yes" });
    expect(batchRowLine(s, "WAYNE WILSON")).toBe("Wayne Wilson said yes · free Ready Check");
  });
  test("said yes and the batch closed → still said yes; blank owner name → Owner", () => {
    const s = batchRowState([sent(), ev("quick_taps_answered", "b1", "2026-11-01T02:00:00Z", { outcome: "pass" }), ev("area_batch_closed", "b1", "2026-11-04T02:00:00Z", { pass_job_ids: ["j1"] })]);
    expect(s).toEqual({ kind: "said_yes" });
    expect(batchRowLine(s, "  ")).toBe("Owner said yes · free Ready Check");
    expect(batchRowLine(s, null)).toBe("Owner said yes · free Ready Check");
  });
  test("declined or never texted → plain row (null)", () => {
    expect(batchRowState([])).toBeNull();
    expect(batchRowState([sent(), ev("quick_taps_answered", "b1", "2026-11-01T02:00:00Z", { outcome: "decline_5yr" })])).toBeNull();
    expect(batchRowLine(null, "Wayne")).toBeNull();
  });
  test("texted, closed with no answer (freed back to the pool) → plain row", () =>
    expect(batchRowState([sent(), ev("area_batch_closed", "b1", "2026-11-04T02:00:00Z", { pass_job_ids: [], freed_job_ids: ["j1"] })])).toBeNull());
  test("no installer name on the batch → 'the installer'", () =>
    expect(batchRowLine(batchRowState([ev("area_batch_sent", "b1", "2026-11-01T01:00:00Z")]), "x")).toBe("Waiting for owner (sent for the installer)"));
  test("tick to Send: at least one, at most 10", () => {
    expect(AREA_BATCH_MAX_HOMES).toBe(10);
    expect(tickSendBlocker(0)).toBe("Tick at least one saved spot.");
    expect(tickSendBlocker(1)).toBeNull();
    expect(tickSendBlocker(10)).toBeNull();
    expect(tickSendBlocker(11)).toBe("Up to 10 homes per Send.");
  });
});
