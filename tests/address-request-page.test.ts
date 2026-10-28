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

const PLACES: Record<string, { street: string; suburb: string; postcode: string; state: string }> = {
  vic: { street: "12 Wattle St", suburb: "Brighton", postcode: "3186", state: "VIC" },
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
  searches.length = 0;
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

  test("query under 3 characters returns []", async () => {
    expect(await search("12")).toEqual([]);
    expect(await search("  1 ")).toEqual([]);
    expect(searches).toEqual([]);
  });
});
