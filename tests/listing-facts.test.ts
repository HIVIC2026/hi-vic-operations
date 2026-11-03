// Saved spots by area, Task 7: listing facts endpoint for the nightly listing check. In-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = { jobs: [], lead_campaign_responses: [], property_facts: [] };
const get = (r: Row, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const writes: string[] = [];
const fakeAdmin = {
  from(table: string) {
    const preds: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null;
    const b: Record<string, unknown> & PromiseLike<unknown> = {
      select() {
        return b;
      },
      eq(c: string, v: unknown) {
        preds.push((r) => get(r, c) === v);
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
      order() {
        return b;
      },
      range() {
        return b;
      },
      maybeSingle() {
        return Promise.resolve({
          data: (tables[table] ?? []).find((r) => preds.every((p) => p(r))) ?? null,
          error: null,
        });
      },
      insert(row: Row) {
        writes.push(table);
        (tables[table] ??= []).push({ ...row });
        return Promise.resolve({ error: null });
      },
      update(p: Row) {
        writes.push(table);
        patch = p;
        return b;
      },
      then(res, rej) {
        const rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (patch) for (const r of rows) Object.assign(r, patch);
        return Promise.resolve({ data: patch ? null : rows, error: null }).then(res, rej);
      },
    };
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
const BANDS: Record<string, string> = {};
mock.module("../src/lib/saved-spot-facts.server", () => ({
  readSpotFacts: async (ids: string[]) =>
    new Map(
      ids.map((id) => [
        id,
        {
          deskCheck: BANDS[id] === "best" ? "looks_eligible" : null,
          aiPhoto: null,
          propertyType: null,
          topFloor: null,
          insulation: BANDS[id] === "weak" ? "present" : "none",
          insulationDetail: "thicker",
        },
      ]),
    ),
}));
process.env["LOVABLE_CRON_SECRET"] = "secret";

const { Route } = await import("../src/routes/api/public/hooks/listing-facts");
type H = (a: { request: Request }) => Promise<Response>;
const handlers = (Route as unknown as { options: { server: { handlers: { GET: H; POST: H } } } })
  .options.server.handlers;
const NOW = Date.now();
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function addSpot(
  id: string,
  o: {
    band: "best" | "weak";
    savedDaysAgo: number;
    address?: string;
    test?: boolean;
    channel?: string;
  },
) {
  BANDS[id] = o.band;
  tables["jobs"]!.push({
    id,
    job_number: `HV-${id}`,
    stage: "ready_check_ready_to_schedule",
    source: o.test ? "qa_test" : "website",
    channel: o.channel ?? "hivic_sourced",
    deleted_at: null,
    qa_archived_at: null,
    property_id: `p-${id}`,
    properties: {
      address_line: o.address ?? "12 Sample Street",
      suburb: "Brunswick",
      postcode: "3056",
    },
  });
  tables["lead_campaign_responses"]!.push({
    job_id: id,
    spot_saved_at: ago(o.savedDaysAgo),
    opted_out_at: null,
  });
}
const req = (
  method: string,
  body?: unknown,
  auth = true,
  url = "http://x/api/public/hooks/listing-facts",
) =>
  new Request(url, {
    method,
    headers: {
      ...(auth ? { authorization: "Bearer secret" } : {}),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const result = (jobId: string, o: Partial<Row> = {}) => ({
  jobId,
  status: "found",
  url: "https://example.com/l",
  source: "domain.com.au",
  floorAreaM2: 180,
  landM2: 600,
  storeys: 1,
  beds: 3,
  yearBuilt: 1975,
  hasFloorPlan: true,
  propertyType: "Semi-detached",
  roof: null,
  ...o,
});
const current = (prop: string) =>
  tables["property_facts"]!.filter(
    (r) =>
      r["property_id"] === prop && r["fact_key"] === "listing_check" && r["is_current"] === true,
  );

beforeEach(() => {
  for (const k of Object.keys(tables)) tables[k] = [];
  writes.length = 0;
});

describe("listing facts endpoint", () => {
  test("no Bearer -> 401 on GET and POST", async () => {
    expect((await handlers.GET({ request: req("GET", undefined, false) })).status).toBe(401);
    expect((await handlers.POST({ request: req("POST", { results: [] }, false) })).status).toBe(
      401,
    );
  });

  test("POST twice for one job leaves exactly one current listing_check, normalised, with the source columns", async () => {
    addSpot("a", { band: "best", savedDaysAgo: 5 });
    expect((await handlers.POST({ request: req("POST", { results: [result("a")] }) })).status).toBe(
      200,
    );
    expect(
      (
        await handlers.POST({
          request: req("POST", {
            results: [
              result("a", {
                status: "not found",
                url: null,
                source: null,
                propertyType: "Apartment",
              }),
            ],
          }),
        })
      ).status,
    ).toBe(200);
    const rows = tables["property_facts"]!.filter((r) => r["fact_key"] === "listing_check");
    expect(rows.length).toBe(2);
    const cur = current("p-a");
    expect(cur.length).toBe(1);
    expect(cur[0]).toMatchObject({
      source_type: "listing",
      source_name: "listing check",
      source_url: null,
    });
    expect((cur[0]!["value"] as Row)["propertyType"]).toBe("unit");
    expect(rows.find((r) => r["is_current"] === false)).toMatchObject({
      source_name: "domain.com.au",
      source_url: "https://example.com/l",
    });
    expect((rows.find((r) => r["is_current"] === false)!["value"] as Row)["propertyType"]).toBe(
      "townhouse",
    );
  });

  test("http(s) urls and a null url are accepted", async () => {
    addSpot("a", { band: "best", savedDaysAgo: 5 });
    for (const url of ["https://example.com/l", "http://example.com/l", "HTTPS://Example.com/l", null])
      expect(
        (await handlers.POST({ request: req("POST", { results: [result("a", { url })] }) })).status,
      ).toBe(200);
  });

  test("only property_facts is written", async () => {
    addSpot("a", { band: "best", savedDaysAgo: 5 });
    await handlers.POST({ request: req("POST", { results: [result("a")] }) });
    expect(new Set(writes)).toEqual(new Set(["property_facts"]));
  });

  test("extra keys, missing keys, bad status, non-http(s) url and more than 100 results -> 400, nothing written", async () => {
    addSpot("a", { band: "best", savedDaysAgo: 5 });
    for (const bad of [
      { ...result("a"), foo: 1 },
      { jobId: "a", status: "found", foo: 1 },
      result("a", { status: "maybe" }),
      result("a", { floorAreaM2: "180" }),
      result("a", { url: "javascript:alert(1)" }),
      result("a", { url: "data:text/html,hi" }),
      result("a", { url: "ftp://example.com/l" }),
    ])
      expect((await handlers.POST({ request: req("POST", { results: [bad] }) })).status).toBe(400);
    expect(
      (
        await handlers.POST({
          request: req("POST", { results: Array.from({ length: 101 }, () => result("a")) }),
        })
      ).status,
    ).toBe(400);
    expect(
      (await handlers.POST({ request: req("POST", { results: [result("a")], extra: 1 }) })).status,
    ).toBe(400);
    expect(tables["property_facts"]!.length).toBe(0);
  });

  test("GET: a 1-day-old Weak spot comes before an old Best; old Best before old Weak; checked, test, no-street homes left out", async () => {
    addSpot("old-weak", { band: "weak", savedDaysAgo: 10 });
    addSpot("old-best", { band: "best", savedDaysAgo: 9 });
    addSpot("new-weak", { band: "weak", savedDaysAgo: 1 });
    addSpot("checked", { band: "best", savedDaysAgo: 8 });
    addSpot("test", { band: "best", savedDaysAgo: 8, test: true });
    addSpot("nostreet", { band: "best", savedDaysAgo: 8, address: "Brunswick" });
    addSpot("installer", { band: "best", savedDaysAgo: 8, channel: "installer_sourced" });
    tables["property_facts"]!.push({
      property_id: "p-checked",
      fact_key: "listing_check",
      is_current: true,
      value: {},
    });
    const res = await handlers.GET({
      request: req("GET", undefined, true, "http://x/api/public/hooks/listing-facts?limit=10"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Row[];
    expect(body.map((r) => r["jobId"])).toEqual(["new-weak", "old-best", "old-weak"]);
    expect(body[0]).toEqual({
      jobId: "new-weak",
      jobNumber: "HV-new-weak",
      address: "12 Sample Street",
      suburb: "Brunswick",
      postcode: "3056",
    });
    const one = (await (
      await handlers.GET({
        request: req("GET", undefined, true, "http://x/api/public/hooks/listing-facts?limit=1"),
      })
    ).json()) as Row[];
    expect(one.length).toBe(1);
  });
});
