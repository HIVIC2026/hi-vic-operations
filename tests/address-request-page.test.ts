// The owner's page to pick their full address (my-address/<token>). In-memory database; the address service is a fake.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { addressRequestOpen } from "../src/lib/address-request.core";
import { LINK_UNAVAILABLE } from "../src/lib/estimatelink.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
function from(table: string) {
  let op: "select" | "insert" | "update" = "select"; let payload: Row = {}; let lim = Infinity; let one = false;
  let orderBy: { col: string; asc: boolean } | null = null;
  const preds: ((r: Row) => boolean)[] = [];
  const b: Record<string, unknown> = {
    select: () => b,
    eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return b; },
    in: (c: string, v: unknown[]) => { preds.push((r) => v.includes(r[c])); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { orderBy ??= { col: c, asc: o?.ascending !== false }; return b; },
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { one = true; return b; },
    single: () => { one = true; return b; },
    insert: (p: Row) => { op = "insert"; payload = p; return b; },
    update: (p: Row) => { op = "update"; payload = p; return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      let data: unknown = null;
      if (op === "insert") (tables[table] ??= []).push({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...payload });
      else if (op === "update") { for (const r of (tables[table] ?? []).filter((r) => preds.every((p) => p(r)))) Object.assign(r, payload); (updates[table] ??= []).push(payload); }
      else {
        let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        if (orderBy) rows = [...rows].sort((x, y) => String(x[orderBy!.col]).localeCompare(String(y[orderBy!.col])) * (orderBy!.asc ? 1 : -1));
        rows = rows.slice(0, lim);
        data = one ? rows[0] ?? null : rows;
      }
      return Promise.resolve({ data, error: null }).then(res, rej);
    },
  };
  return b;
}
const updates: Record<string, Row[]> = {};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));

// Server fns run their handler directly (same stand-in as other server-fn tests).
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = {
      middleware: () => b,
      inputValidator: (f: typeof validate) => { validate = f; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => (a: { data: unknown }) => h({ data: validate(a.data), context: {} }),
    };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("../src/lib/request-meta", () => ({ withRequestMeta: {} }));

// After a save the job is re-routed through the automatic router (it sends Save my spot); stubbed here, proven end to end
// in address-request-carry-on.test.ts.
const routed: string[] = [];
let routeThrows = false;
mock.module("../src/lib/lead-email-routing.server", () => ({
  maybeAutoRouteLeadEmail: async (jobId: string) => { routed.push(jobId); if (routeThrows) throw new Error("router down"); return { route: "offer_spot", sent: true, reason: "stub" }; },
}));

const PLACES: Record<string, { street: string; suburb: string; postcode: string; state: string }> = {
  vic: { street: "12 Wattle St", suburb: "Brighton", postcode: "3186", state: "VIC" },
  suburb: { street: "", suburb: "Brighton", postcode: "3186", state: "VIC" },
  nonumber: { street: "Wattle St", suburb: "Brighton", postcode: "3186", state: "VIC" },
  nsw: { street: "3 Smith St", suburb: "Albury", postcode: "2640", state: "NSW" },
};
const searches: string[] = [];
mock.module("../src/lib/address-lookup.server", () => ({
  searchAddressSuggestions: async (q: string) => { searches.push(q); return [{ id: "vic", label: "12 Wattle St, Brighton VIC 3186" }]; },
  lookupAddressDetails: async (id: string) => {
    const p = PLACES[id];
    return p ? { label: "", ...p, country: "AU", provider: "google_places_au", latitude: null, longitude: null } : null;
  },
}));

const TOKEN = "a".repeat(43);
const GO_LIVE = "2026-10-20T00:00:00Z";
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(updates)) delete updates[k];
  searches.length = 0; routed.length = 0; routeThrows = false;
  tables["workflow_settings"] = [{ id: 1, address_request_live_at: GO_LIVE }];
  tables["owners"] = [{ id: "o1", full_name: "Pat Owner" }];
  tables["properties"] = [{ id: "p1", address_line: "Brighton VIC 3186", suburb: null, postcode: "3186", state: "VIC" }];
  tables["jobs"] = [{ id: "j1", source: "base44", channel: "hivic_sourced", created_at: "2026-10-27T00:00:00Z", deleted_at: null, owner_id: "o1", property_id: "p1", owners: tables["owners"][0], properties: tables["properties"][0] }];
  tables["customer_estimate_links"] = [{ id: "l1", job_id: "j1", purpose: "step3_estimate", status: "active", token: TOKEN, expires_at: "2099-01-01T00:00:00Z" }];
  tables["workflow_events"] = [];
}
const answered = () => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === "address_request_answered");

const { saveOwnerAddress, searchOwnerAddress, getOwnerAddressState } = await import("../src/lib/address-request.functions");
const save = (placeId: string, token = TOKEN) => saveOwnerAddress({ data: { token, placeId } });
const search = (query: string, token = TOKEN) => searchOwnerAddress({ data: { token, query } });

describe("owner picks their full address", () => {
  beforeEach(() => seed());

  test("older job created before go-live (Jo 30 Oct) → open, the owner can pick", async () => {
    tables["jobs"]![0]!["created_at"] = "2026-09-01T00:00:00Z";
    expect((await getOwnerAddressState({ data: { token: TOKEN } })).state).toBe("open");
    expect(await save("vic")).toEqual({ ok: true });
    expect(answered()).toHaveLength(1);
  });

  test("Victorian pick → address saved, answered event logged, request closed (Save my spot no longer held)", async () => {
    const { loadAddressRequestFacts } = await import("../src/lib/address-request.server");
    expect(addressRequestOpen((await loadAddressRequestFacts("j1"))!)).toBe(true);
    expect(await save("vic")).toEqual({ ok: true });
    expect(tables["properties"]![0]).toMatchObject({ address_line: "12 Wattle St", suburb: "Brighton", postcode: "3186" });
    expect(tables["owners"]![0]!["full_name"]).toBe("Pat Owner");
    expect(answered()).toHaveLength(1);
    expect(answered()[0]!["summary"]).toBe("Owner gave their full address");
    expect(addressRequestOpen((await loadAddressRequestFacts("j1"))!)).toBe(false);
    expect(await getOwnerAddressState({ data: { token: TOKEN } })).toEqual({ state: "answered" });
    expect(routed).toEqual(["j1"]); // carries on by itself: re-routed once after the save
  });

  test("router fails after the save → the owner's save still succeeds (error logged only)", async () => {
    routeThrows = true;
    expect(await save("vic")).toEqual({ ok: true });
    expect(answered()).toHaveLength(1);
    expect(routed).toEqual(["j1"]);
  });

  test("a suburb (or a street with no number) picked from the list → choose your full street address; nothing saved", async () => {
    for (const id of ["suburb", "nonumber"]) {
      expect(await save(id)).toEqual({ ok: false, error: "Please choose your full street address from the list." });
    }
    expect(tables["properties"]![0]!["address_line"]).toBe("Brighton VIC 3186");
    expect(updates["properties"] ?? []).toEqual([]);
    expect(answered()).toHaveLength(0);
    expect(routed).toEqual([]);
  });

  test("NSW pick → Victorian postcode error, nothing saved", async () => {
    expect(await save("nsw")).toEqual({ ok: false, error: "The postcode must be a Victorian postcode." });
    expect(tables["properties"]![0]!["address_line"]).toBe("Brighton VIC 3186");
    expect(answered()).toHaveLength(0);
  });

  test("unknown place → couldn't find that address", async () => {
    expect(await save("nowhere")).toEqual({ ok: false, error: "We couldn't find that address. Please try again." });
    expect(answered()).toHaveLength(0);
  });

  test("second save on an answered job → ok with no second save", async () => {
    expect(await save("vic")).toEqual({ ok: true });
    const before = (updates["properties"] ?? []).length;
    expect(await save("vic")).toEqual({ ok: true });
    expect((updates["properties"] ?? []).length).toBe(before);
    expect(answered()).toHaveLength(1);
  });

  test("bad, unknown, expired or deleted-job token → link unavailable", async () => {
    expect(await save("vic", "bad")).toEqual({ ok: false, error: LINK_UNAVAILABLE });
    expect(await save("vic", "b".repeat(43))).toEqual({ ok: false, error: LINK_UNAVAILABLE });
    await expect(search("12 Wattle", "b".repeat(43))).rejects.toThrow(LINK_UNAVAILABLE);
    expect(await getOwnerAddressState({ data: { token: "b".repeat(43) } })).toEqual({ state: "unavailable" });
    tables["customer_estimate_links"]![0]!["expires_at"] = "2020-01-01T00:00:00Z";
    expect(await save("vic")).toEqual({ ok: false, error: LINK_UNAVAILABLE });
    seed();
    tables["jobs"]![0]!["deleted_at"] = "2026-10-27T05:00:00Z";
    expect(await save("vic")).toEqual({ ok: false, error: LINK_UNAVAILABLE });
    expect(answered()).toHaveLength(0);
    expect(searches).toEqual([]);
  });

  test("search with a good token returns suggestions; open state before answering", async () => {
    expect(await getOwnerAddressState({ data: { token: TOKEN } })).toEqual({ state: "open" });
    expect(await search("12 Wattle")).toEqual([{ id: "vic", label: "12 Wattle St, Brighton VIC 3186" }]);
    expect(searches).toEqual(["12 Wattle"]);
  });

  const notWaiting: [string, () => void][] = [
    ["office/partner-channel job", () => { tables["jobs"]![0]!["channel"] = "installer_sourced"; }],
    ["cancelled job", () => { tables["jobs"]![0]!["stage"] = "cancelled"; }],
    ["deleted job", () => { tables["jobs"]![0]!["deleted_at"] = "2026-10-29T00:00:00Z"; }],
    ["job whose street is already full", () => { tables["properties"]![0]!["address_line"] = "7 Gum Rd"; }],
    ["feature switched off (no go-live date)", () => { tables["workflow_settings"]![0]!["address_request_live_at"] = null; }],
    ["owner told Does Not Appear Eligible", () => { tables["jobs"]![0]!["eligibility_outcome"] = "does_not_appear_eligible"; }],
  ];
  for (const [name, setUp] of notWaiting) {
    test(`${name} → unavailable, save refused, address unchanged, no event`, async () => {
      setUp();
      const before = { ...tables["properties"]![0]! };
      expect(await getOwnerAddressState({ data: { token: TOKEN } })).toEqual({ state: "unavailable" });
      expect(await save("vic")).toEqual({ ok: false, error: LINK_UNAVAILABLE });
      expect(tables["properties"]![0]).toEqual(before);
      expect(updates["properties"] ?? []).toEqual([]);
      expect(updates["owners"] ?? []).toEqual([]);
      expect(answered()).toHaveLength(0);
      expect(tables["workflow_events"]).toEqual([]);
      expect(routed).toEqual([]);
    });
  }

  test("query under 4 characters returns [] (the address service finds nothing shorter); 4 characters searches", async () => {
    expect(await search("12")).toEqual([]);
    expect(await search("12 W")).toEqual([{ id: "vic", label: "12 Wattle St, Brighton VIC 3186" }]);
    expect(await search(" 12W ")).toEqual([]);
    expect(await search("  1 ")).toEqual([]);
    expect(searches).toEqual(["12 W"]);
  });
});
