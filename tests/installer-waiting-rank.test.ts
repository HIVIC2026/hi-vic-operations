// Saved spots by area, Task 4: the To release loader carries each saved spot's band, reason, tags, location and links,
// plus the ~10 km area groups (To release rows only). In-memory fake database; joined rows are stored pre-joined.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
/** Every table read, in order (I4: no table is read twice for the ranking). */
const reads: string[] = [];
const get = (r: Row, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
function fakeAdmin() {
  return {
    from(table: string) {
      reads.push(table);
      const preds: ((r: Row) => boolean)[] = [];
      const b: Record<string, unknown> & PromiseLike<unknown> = {
        select() {
          return b;
        },
        eq(c: string, v: unknown) {
          preds.push((r) => get(r, c) === v);
          return b;
        },
        neq(c: string, v: unknown) {
          preds.push((r) => get(r, c) !== v);
          return b;
        },
        in(c: string, v: unknown[]) {
          preds.push((r) => v.includes(get(r, c)));
          return b;
        },
        is(c: string, v: unknown) {
          preds.push((r) => (get(r, c) ?? null) === v);
          return b;
        },
        not(c: string, _op: string, v: unknown) {
          preds.push((r) => (get(r, c) ?? null) !== v);
          return b;
        },
        or() {
          return b;
        },
        order() {
          return b;
        },
        range() {
          return b;
        },
        then(res, rej) {
          const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
          return Promise.resolve({ data: hit, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
mock.module("../src/lib/readycheck-booking.server", () => ({
  installerOfferFacts: async () => ({
    credentialsOk: () => true,
    fullCertified: () => 1,
    installerGap: () => null,
    credentialsGap: () => null,
  }),
}));
mock.module("../src/lib/spot-release.server", () => ({ spotReleaseStates: async () => new Map() }));

const { loadInstallerWaitingList } = await import("../src/lib/installer-waiting.server");
const { readSpotFacts } = await import("../src/lib/saved-spot-facts.server");

const NOW = Date.parse("2026-11-03T00:00:00.000Z");
function job(id: string, prop: Row, extra: Row = {}): Row {
  return {
    id,
    job_number: `HV-${id}`,
    stage: "ready_check_ready_to_schedule",
    source: null,
    channel: "hivic_sourced",
    created_at: "2026-10-01T00:00:00.000Z",
    estimated_area_m2: null,
    deleted_at: null,
    qa_archived_at: null,
    life_support: false,
    property_id: `p-${id}`,
    owners: { full_name: `Owner ${id}` },
    properties: {
      address_line: null,
      suburb: "",
      postcode: "",
      declared: null,
      answers: null,
      ...prop,
    },
    ...extra,
  };
}
const saved = (id: string, extra: Row = {}): Row => ({
  job_id: id,
  spot_saved_at: "2026-10-20T00:00:00.000Z",
  opted_out_at: null,
  saved_total: 900,
  saved_area_m2: null,
  saved_insulation: null,
  desk_check_status: null,
  desk_check_reason: null,
  ...extra,
});
const fact = (id: string, key: string, value: unknown): Row => ({
  property_id: `p-${id}`,
  fact_key: key,
  value,
  is_current: true,
});

beforeEach(() => {
  reads.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  tables["jobs"] = [
    // a: no insulation, house, 200 m², street address in Rowville → Good
    job(
      "a",
      {
        address_line: "12 Smith Street",
        suburb: "Rowville",
        postcode: "3178",
        declared: { property_type: "house" },
      },
      { life_support: true },
    ),
    // b: Jo's desk check looks eligible → Best (postcode-only in Rowville's postcode)
    job("b", {
      suburb: "Rowville",
      postcode: "3178",
      answers: { property_type: "unit", top_floor: "yes" },
    }),
    // c: has insulation, no detail → Weak (street address, coordinates in Glen Waverley)
    job("c", { address_line: "4 Jones Road", suburb: "Glen Waverley", postcode: "3150" }),
    // d: no coordinates, postcode with no known centre (ACT) → Location not known
    job("d", { suburb: "Nowhere", postcode: "2600" }),
  ];
  tables["lead_campaign_responses"] = [
    saved("a", { saved_insulation: "none", saved_area_m2: 200 }),
    saved("b", {
      saved_insulation: "present",
      desk_check_status: "looks_eligible",
      desk_check_reason: "Thin/loose-fill insulation only",
    }),
    saved("c", { saved_insulation: "present" }),
    saved("d", { saved_insulation: "unknown" }),
  ];
  tables["property_facts"] = [
    fact("a", "coordinates", [145.2416, -37.9244]),
    fact("a", "roof_form", "pitched"),
    fact("a", "building_ground_footprint", { m2: 187.6, roof_surface_m2_not_used: 230 }),
    fact("a", "solar_summary", { roof_ground_area_m2: 200.4 }),
    fact("a", "site_roof_risk", { flags: [] }),
    fact("a", "listing_check", {
      status: "found",
      url: "https://example.com/12-smith",
      hasFloorPlan: true,
      propertyType: "House",
      storeys: 1,
    }),
    fact("c", "coordinates", [145.1688, -37.9144]),
    fact("c", "site_roof_risk", { flags: ["likely flat/low-slope roof"] }),
    { ...fact("c", "roof_form", "pitched"), is_current: false },
  ];
  tables["workflow_events"] = [
    {
      job_id: "a",
      event_type: "quick_taps_answered",
      created_at: "2026-10-25T00:00:00.000Z",
      details: { answers: { hatch: "no", roof: "flat" } },
    },
    {
      job_id: "a",
      event_type: "quick_taps_answered",
      created_at: "2026-10-26T00:00:00.000Z",
      details: { answers: { hatch: "yes", roof: "sloped" } },
    },
  ];
});

describe("To release loader: band, reason, tags, areas", () => {
  test("bands, reasons, links and tags per saved spot", async () => {
    const { rows } = await loadInstallerWaitingList({ includeTest: true });
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get("a")!.band).toBe("good");
    expect(by.get("b")!.band).toBe("best");
    expect(by.get("c")!.band).toBe("weak");
    for (const id of ["a", "b", "c", "d"]) expect(by.get(id)!.reason!.length).toBeGreaterThan(0);
    expect(by.get("a")!.reason).toBe(
      "No insulation · house · ~170 m² · floor plan found · pitched roof",
    );
    expect(by.get("a")!.tags).toEqual(["Life support"]);
    expect(by.get("a")!.satelliteUrl).toBe(
      `https://www.google.com/maps/place/${encodeURIComponent("12 Smith Street, Rowville VIC 3178")}/data=!3m1!1e3`,
    );
    expect(by.get("a")!.listingUrl).toBe("https://example.com/12-smith");
    expect(by.get("a")!.lat).toBeCloseTo(-37.9244);
    // postcode-only: postcode centre, no links, "No street address"
    expect(by.get("b")!.satelliteUrl).toBeNull();
    expect(by.get("b")!.listingUrl).toBeNull();
    expect(by.get("b")!.lat).toBeCloseTo(-37.924431);
    expect(by.get("b")!.tags).toContain("No street address");
    expect(by.get("c")!.tags).toContain("Not checked yet");
    expect(by.get("d")!.lat).toBeNull();
  });

  test("estimated ceiling: roof ground area × 0.85 to nearest 5, areaM2 unchanged", async () => {
    const { rows } = await loadInstallerWaitingList({ includeTest: true });
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get("a")!.estCeiling).toEqual({ m2: 170, source: "above" });
    expect(by.get("a")!.areaM2).toBe(200);
    expect(by.get("c")!.estCeiling).toBeNull();
  });

  test("areas hold every To release id once; unknown location is the last group", async () => {
    const { areas } = await loadInstallerWaitingList({ includeTest: true });
    const ids = areas.flatMap((g) => g.jobIds);
    expect(ids.sort()).toEqual(["a", "b", "c", "d"]);
    expect(areas.at(-1)!.heading).toBe("Location not known (1)");
    expect(areas.at(-1)!.locationKnown).toBe(false);
    // a and b (Rowville) and c (Glen Waverley, ~7 km away) are within 10 km → one group, best-ranked first
    expect(areas[0]!.jobIds).toEqual(["b", "a", "c"]);
  });

  test("readSpotFacts reads the latest quick taps, current facts only, life support and declared answers", async () => {
    const facts = await readSpotFacts(["a", "b", "c", "d"], { now: NOW });
    const a = facts.get("a")!;
    expect(a.tapsHatch).toBe("yes");
    expect(a.tapsRoof).toBe("sloped");
    expect(a.lifeSupport).toBe(true);
    expect(a.propertyType).toBe("house");
    expect(a.listing).toEqual({
      found: true,
      floorPlan: true,
      type: "House",
      storeys: 1,
      checked: true,
    });
    expect(a.address).toBe("12 Smith Street, Rowville VIC 3178");
    const b = facts.get("b")!;
    expect(b.propertyType).toBe("apartment");
    expect(b.topFloor).toBe("yes");
    expect(b.deskCheck).toBe("looks_eligible");
    expect(b.insulationDetail).toBe("loose_fill");
    expect(b.streetKnown).toBe(false);
    const c = facts.get("c")!;
    expect(c.roofForm).toBeNull(); // the only roof_form row is not current
    expect(c.complexRoof).toBe(true);
    expect(c.listing).toBeNull();
    expect(facts.get("d")!.lat).toBeNull();
  });

  test("Jo's not_eligible and needs_onsite_check desk checks are kept, and beat the AI", async () => {
    tables["lead_campaign_responses"]![0]!["desk_check_status"] = "not_eligible";
    tables["lead_campaign_responses"]![2]!["desk_check_status"] = "needs_onsite_check";
    tables["property_facts"]!.push(
      fact("a", "ai_photo_check", { verdict: "none" }),
      fact("c", "ai_photo_check", { verdict: "under_r2" }),
    );
    const facts = await readSpotFacts(["a", "c"], { now: NOW });
    expect(facts.get("a")!.deskCheck).toBe("not_eligible");
    expect(facts.get("c")!.deskCheck).toBe("needs_onsite_check");
    const { rows } = await loadInstallerWaitingList({ includeTest: true });
    const by = new Map(rows.map((r) => [r.id, r]));
    expect(by.get("a")!.band).toBe("weak");
    expect(by.get("a")!.tags).toContain("Jo: not eligible");
    expect(by.get("c")!.band).toBe("weak"); // has insulation, no detail; AI under_r2 ignored
    expect(by.get("c")!.tags).not.toContain("AI: confirm");
  });

  test("readSpotFacts with the rows handed in reads only property facts", async () => {
    const rows = {
      jobs: tables["jobs"]!,
      saved: tables["lead_campaign_responses"]!,
      events: tables["workflow_events"]!,
    };
    const fromDb = await readSpotFacts(["a", "b", "c", "d"], { now: NOW });
    reads.length = 0;
    const handed = await readSpotFacts(["a", "b", "c", "d"], { now: NOW, rows });
    expect(reads).toEqual(["property_facts"]);
    expect([...handed]).toEqual([...fromDb]);
    reads.length = 0;
    await readSpotFacts(["a", "b"], { now: NOW, rows, facts: tables["property_facts"]! });
    expect(reads).toEqual([]);
  });

  test("the loader reads jobs, saved spots, events and property facts once each", async () => {
    await loadInstallerWaitingList({ includeTest: true });
    const n = (t: string) => reads.filter((r) => r === t).length;
    expect(n("jobs")).toBe(1);
    expect(n("lead_campaign_responses")).toBe(1);
    expect(n("workflow_events")).toBe(1);
    expect(n("property_facts")).toBe(1);
  });
});
