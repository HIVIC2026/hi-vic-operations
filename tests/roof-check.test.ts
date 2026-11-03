import { beforeEach, expect, mock, test } from "bun:test";
import { memoryPostgrest, type Tables } from "./helpers/memory-postgrest";
const tables: Tables = {};
const db = memoryPostgrest(tables);
mock.module("../src/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: (t: string) => db.from(t) },
}));
mock.module("../src/lib/property-coordinates.server", () => ({
  ensurePropertyCoordinates: async () => null,
}));
const { runRoofCheck, roofCheckTick, clearRoofCheckBackoff } =
  await import("../src/lib/roof-check.server");
const solar = {
  name: "buildings/x",
  center: { latitude: -37.8, longitude: 144.9 },
  imageryDate: { year: 2023, month: 1, day: 1 },
  imageryQuality: "HIGH",
  solarPotential: {
    buildingStats: { areaMeters2: 150, groundAreaMeters2: 120 },
    wholeRoofStats: { areaMeters2: 150, groundAreaMeters2: 120 },
    roofSegmentStats: [
      { pitchDegrees: 22, stats: { areaMeters2: 80, groundAreaMeters2: 70 } },
      { pitchDegrees: 23, stats: { areaMeters2: 70, groundAreaMeters2: 50 } },
    ],
  },
};
let calls = 0;
const ok = async () => {
  calls++;
  return { status: 200, json: solar };
};
const notFound = async () => {
  calls++;
  return { status: 404, json: null };
};
const jobRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  property_id: "p" + id,
  stage: "ready_check_ready_to_schedule",
  source: "real",
  deleted_at: null,
  qa_archived_at: null,
  ...extra,
});
const setup = () => {
  for (const k of Object.keys(tables)) delete tables[k];
  Object.assign(tables, {
    jobs: [jobRow("a")],
    properties: [{ id: "pa", address_line: "12 Wattle Street", postcode: "3141" }],
    lead_campaign_responses: [
      { job_id: "a", spot_saved_at: "2026-11-01T00:00:00Z", opted_out_at: null },
    ],
    property_facts: [
      {
        id: "c",
        property_id: "pa",
        fact_key: "coordinates",
        value: [144.9, -37.8],
        is_current: true,
      },
    ],
    workflow_events: [],
  });
};
beforeEach(() => {
  clearRoofCheckBackoff();
  setup();
  calls = 0;
  process.env.GOOGLE_SOLAR_API_KEY = "k";
});
const current = (key: string) =>
  tables.property_facts!.filter((f) => f.fact_key === key && f.is_current);
test("success writes the roof facts, logs one internal event and leaves jobs alone", async () => {
  const before = JSON.stringify(tables.jobs);
  expect(await runRoofCheck("a", ok)).toBe("done");
  for (const k of ["roof_form", "site_roof_risk", "building_ground_footprint", "solar_summary"])
    expect(current(k)).toHaveLength(1);
  expect(tables.property_facts!.some((f) => f.fact_key === "age_supporting_solar")).toBe(false);
  expect(
    tables.workflow_events!.filter((e) => e.event_type === "roof_checked" && e.internal),
  ).toHaveLength(1);
  expect(JSON.stringify(tables.jobs)).toBe(before);
});
test("re-run supersedes only the roof facts", async () => {
  await runRoofCheck("a", ok);
  await runRoofCheck("a", ok);
  expect(current("roof_form")).toHaveLength(1);
  expect(tables.property_facts!.filter((f) => f.fact_key === "roof_form")).toHaveLength(2);
  expect(current("coordinates")).toHaveLength(1);
});
test("HTTP 404 fails quietly with no facts", async () => {
  expect(await runRoofCheck("a", notFound)).toBe("failed");
  expect(tables.property_facts!.filter((f) => f.fact_key === "roof_form")).toHaveLength(0);
  expect(tables.workflow_events!.filter((e) => e.event_type === "roof_check_failed")).toHaveLength(
    1,
  );
});
test("missing key is skipped with no event and no call", async () => {
  delete process.env.GOOGLE_SOLAR_API_KEY;
  expect(await runRoofCheck("a", ok)).toBe("skipped");
  expect(calls).toBe(0);
  expect(tables.workflow_events).toHaveLength(0);
});
test("postcode-only home is not picked", async () => {
  tables.properties![0]!.address_line = "Melbourne 3141";
  expect(await roofCheckTick({ limit: 5 })).toEqual({ done: 0, failed: 0 });
});
test("TEST job is not picked and never calls Google", async () => {
  tables.jobs![0]!.source = "qa_test";
  expect(await roofCheckTick({ limit: 5 })).toEqual({ done: 0, failed: 0 });
  expect(await runRoofCheck("a", ok)).toBe("skipped");
  expect(calls).toBe(0);
});
test("a failed try is not repeated within 24 hours", async () => {
  tables.workflow_events!.push({
    job_id: "a",
    event_type: "roof_check_failed",
    created_at: new Date(Date.now() - 3600_000).toISOString(),
  });
  expect(await roofCheckTick({ limit: 5 })).toEqual({ done: 0, failed: 0 });
  tables.workflow_events![0]!.created_at = new Date(Date.now() - 25 * 3600_000).toISOString();
  expect((await roofCheckTick({ limit: 5, http: notFound })).failed).toBe(1);
});
test("opted-out and already-checked homes are not picked", async () => {
  tables.lead_campaign_responses![0]!.opted_out_at = "2026-11-02T00:00:00Z";
  expect(await roofCheckTick({ limit: 5 })).toEqual({ done: 0, failed: 0 });
  tables.lead_campaign_responses![0]!.opted_out_at = null;
  tables.property_facts!.push({
    id: "r",
    property_id: "pa",
    fact_key: "roof_form",
    value: "pitched",
    is_current: true,
  });
  expect(await roofCheckTick({ limit: 5 })).toEqual({ done: 0, failed: 0 });
});
test("stops for the day after 300 checks since Melbourne midnight", async () => {
  const now = new Date().toISOString();
  for (let i = 0; i < 299; i++)
    tables.workflow_events!.push({
      id: "x" + i,
      job_id: "z" + i,
      event_type: i % 2 ? "roof_checked" : "roof_check_failed",
      created_at: now,
    });
  expect(await roofCheckTick({ limit: 5, http: ok })).toEqual({ done: 1, failed: 0 }); // only 1 left of the 300
  tables.jobs!.push(jobRow("b"));
  tables.properties!.push({ id: "pb", address_line: "3 Gum Road", postcode: "3141" });
  tables.lead_campaign_responses!.push({
    job_id: "b",
    spot_saved_at: "2026-11-02T00:00:00Z",
    opted_out_at: null,
  });
  tables.property_facts!.push({
    id: "c2",
    property_id: "pb",
    fact_key: "coordinates",
    value: [144.9, -37.8],
    is_current: true,
  });
  const before = calls;
  expect(await roofCheckTick({ limit: 5, http: ok })).toEqual({ done: 0, failed: 0 });
  expect(calls).toBe(before);
});
test("checks from before Melbourne midnight do not count", async () => {
  const old = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
  for (let i = 0; i < 300; i++)
    tables.workflow_events!.push({
      id: "o" + i,
      job_id: "z" + i,
      event_type: "roof_checked",
      created_at: old,
    });
  expect(await roofCheckTick({ limit: 5, http: ok })).toEqual({ done: 1, failed: 0 });
});
test("if the event row cannot be written, the failure still throttles and nothing throws", async () => {
  const ev = tables.workflow_events!;
  (ev as unknown as { push: () => never }).push = () => {
    throw new Error("db down");
  };
  // The start can't be recorded, so Google is never called; the job is still throttled in memory.
  expect(await roofCheckTick({ limit: 5, http: notFound })).toEqual({ done: 0, failed: 1 });
  expect(calls).toBe(0);
  expect(await roofCheckTick({ limit: 5, http: notFound })).toEqual({ done: 0, failed: 0 });
  expect(calls).toBe(0);
});
test("a 404 (no coverage) backs off 7 days, other failures 24 hours", async () => {
  const age = (ms: number) => {
    for (const e of tables.workflow_events!) e.created_at = new Date(Date.now() - ms).toISOString();
  };
  expect(await runRoofCheck("a", notFound)).toBe("failed");
  age(3 * 24 * 3600_000);
  expect(await roofCheckTick({ limit: 5, http: ok })).toEqual({ done: 0, failed: 0 });
  age(8 * 24 * 3600_000);
  expect(await roofCheckTick({ limit: 5, http: ok })).toEqual({ done: 1, failed: 0 });
  const boom = async () => ({ status: 500, json: null });
  tables.property_facts = tables.property_facts!.filter((f) => f.fact_key !== "roof_form");
  tables.workflow_events!.length = 0;
  expect(await runRoofCheck("a", boom)).toBe("failed");
  age(25 * 3600_000);
  expect((await roofCheckTick({ limit: 5, http: ok })).done).toBe(1);
});

test("a started event is written before the Solar call, then the result", async () => {
  expect(await runRoofCheck("a", ok)).toBe("done");
  expect(tables.workflow_events!.map((e) => e.event_type)).toEqual([
    "roof_check_started",
    "roof_checked",
  ]);
});
test("started events count toward the daily cap", async () => {
  const now = new Date().toISOString();
  for (let i = 0; i < 300; i++)
    tables.workflow_events!.push({
      id: "s" + i,
      job_id: "z" + i,
      event_type: "roof_check_started",
      created_at: now,
    });
  expect(await roofCheckTick({ limit: 5, http: ok })).toEqual({ done: 0, failed: 0 });
  expect(calls).toBe(0);
});
test("a start with no result (cut off) blocks the job for 24 hours", async () => {
  tables.workflow_events!.push({
    job_id: "a",
    event_type: "roof_check_started",
    created_at: new Date(Date.now() - 3600_000).toISOString(),
  });
  expect(await roofCheckTick({ limit: 5, http: ok })).toEqual({ done: 0, failed: 0 });
  expect(calls).toBe(0);
  tables.workflow_events![0]!.created_at = new Date(Date.now() - 25 * 3600_000).toISOString();
  expect(await roofCheckTick({ limit: 5, http: ok })).toEqual({ done: 1, failed: 0 });
});
