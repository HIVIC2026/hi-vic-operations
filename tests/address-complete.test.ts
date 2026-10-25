// Decision 281 (Jo 25 Oct 2026): the portal completes enquiry addresses itself — fills ONLY the blanks, accepts a lookup
// only when it agrees with what the owner typed, one lookup per job per 7 days, no Fix details pile. Pure core first;
// then the server path against an in-memory database and an injected lookup (no network, no live service).
import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ADDRESS_COMPLETE_BATCH, ADDRESS_LOOKUP_RETRY_DAYS, addressMissing, addressTokens, candidateAgrees, decideAddressCompletion, lookupDue, lookupQuery, parseStreet, shortlistLabels,
} from "../src/lib/address-complete.core";

const clayton = { label: "12 Wattle Street, Clayton VIC, Australia", street: "12 Wattle Street", suburb: "Clayton", postcode: "3168", state: "VIC" };
const claytonNorth = { label: "12 Wattle Street, Clayton North VIC, Australia", street: "12 Wattle Street", suburb: "Clayton North", postcode: "3168", state: "VIC" };
const nsw = { label: "12 Wattle Street, Killara NSW, Australia", street: "12 Wattle Street", suburb: "Killara", postcode: "2071", state: "NSW" };

describe("address-complete core", () => {
  test("street parsing: number + name, unit and range forms, street types compared in full", () => {
    expect(parseStreet("12 wattle st")).toEqual({ number: "12", name: ["wattle", "street"] });
    expect(parseStreet("12A Wattle St Clayton")).toEqual({ number: "12a", name: ["wattle", "street", "clayton"] });
    expect(parseStreet("Unit 3/22 High Street Road")).toEqual({ number: "22", name: ["high", "street", "road"] });
    expect(parseStreet("3/22 High St")).toEqual({ number: "22", name: ["high", "street"] });
    expect(parseStreet("10-12 Carrington Rd, Box Hill 3128")).toEqual({ number: "10", name: ["carrington", "road", "box", "hill"] });
    expect(parseStreet("Wattle Street")).toBeNull();
    expect(parseStreet("")).toBeNull();
    expect(addressTokens("O'Brien Pde VIC")).toEqual(["obrien", "parade"]);
  });

  test("candidate agrees only on the same number + street name, VIC postcode, and the stored suburb / postcode when given", () => {
    const stored = { addressLine: "12 wattle st", suburb: null, postcode: null };
    expect(candidateAgrees(stored, clayton)).toBe(true);
    expect(candidateAgrees(stored, { ...clayton, street: "14 Wattle Street" })).toBe(false); // other number
    expect(candidateAgrees(stored, { ...clayton, street: "12 Wattle Grove" })).toBe(false); // other street
    expect(candidateAgrees(stored, nsw)).toBe(false); // not Victoria
    expect(candidateAgrees(stored, { ...clayton, postcode: "9999" })).toBe(false); // not a Victorian postcode
    expect(candidateAgrees(stored, { ...clayton, suburb: "" })).toBe(false); // nothing to fill
    expect(candidateAgrees({ ...stored, suburb: "Clayton" }, claytonNorth)).toBe(false); // owner said Clayton
    expect(candidateAgrees({ ...stored, postcode: "3170" }, clayton)).toBe(false); // owner said 3170
    expect(candidateAgrees({ ...stored, suburb: "clayton" }, clayton)).toBe(true);
    // Suburb baked into the street line must be the candidate's suburb.
    expect(candidateAgrees({ addressLine: "12 wattle st clayton", suburb: null, postcode: null }, clayton)).toBe(true);
    expect(candidateAgrees({ addressLine: "12 wattle st clayton", suburb: null, postcode: null }, claytonNorth)).toBe(false);
    expect(candidateAgrees({ addressLine: "12 wattle st clayton 3168", suburb: null, postcode: null }, clayton)).toBe(true);
    // No stored street number → never trusted; label-only candidate parsed up to the comma.
    expect(candidateAgrees({ addressLine: "Wattle Street", suburb: null, postcode: null }, clayton)).toBe(false);
    expect(candidateAgrees(stored, { label: clayton.label, suburb: "Clayton", postcode: "3168" })).toBe(true);
    expect(candidateAgrees(stored, { label: "Wattle Street, Clayton VIC", suburb: "Clayton", postcode: "3168" })).toBe(false);
  });

  test("decision fills only the blanks and keeps the owner's words", () => {
    const d = decideAddressCompletion({ addressLine: "12 wattle st", suburb: null, postcode: null }, [clayton]);
    expect(d).toEqual({ kind: "complete", street: "12 Wattle St", suburb: "Clayton", postcode: "3168", filled: ["suburb", "postcode", "street"], candidate: clayton.label });
    // Suburb baked into the line is split off; capitalisation tidied (decision 216), words kept.
    expect(decideAddressCompletion({ addressLine: "12 wattle st clayton", suburb: null, postcode: null }, [clayton])).toMatchObject({ kind: "complete", street: "12 Wattle St", suburb: "Clayton", postcode: "3168" });
    // Stored suburb wins; only the postcode is filled.
    expect(decideAddressCompletion({ addressLine: "12 Wattle St", suburb: "Clayton", postcode: null }, [clayton])).toMatchObject({ kind: "complete", suburb: "Clayton", postcode: "3168", filled: ["postcode"] });
    // Stored postcode wins; only the suburb is filled.
    expect(decideAddressCompletion({ addressLine: "12 Wattle St", suburb: "", postcode: "3168" }, [clayton])).toMatchObject({ kind: "complete", suburb: "Clayton", postcode: "3168", filled: ["suburb"] });
    // Already complete → nothing to do, even with candidates.
    expect(decideAddressCompletion({ addressLine: "12 Wattle St", suburb: "Clayton", postcode: "3168" }, [claytonNorth])).toEqual({ kind: "nothing_missing" });
  });

  test("decision refuses: no street number, no candidates, nothing agreeing, more than one suburb/postcode", () => {
    expect(decideAddressCompletion({ addressLine: "Wattle Street", suburb: null, postcode: null }, [clayton])).toEqual({ kind: "unresolved", reason: "no_street", candidates: [clayton.label] });
    expect(decideAddressCompletion({ addressLine: "12 Wattle St", suburb: null, postcode: null }, [])).toEqual({ kind: "unresolved", reason: "no_candidates", candidates: [] });
    expect(decideAddressCompletion({ addressLine: "12 Wattle St", suburb: null, postcode: null }, [nsw, { ...clayton, street: "14 Wattle Street" }])).toMatchObject({ kind: "unresolved", reason: "no_match" });
    expect(decideAddressCompletion({ addressLine: "12 Wattle St", suburb: null, postcode: null }, [clayton, claytonNorth])).toMatchObject({ kind: "unresolved", reason: "ambiguous", candidates: [clayton.label, claytonNorth.label] });
    // The same place offered twice is one candidate, not an ambiguity.
    expect(decideAddressCompletion({ addressLine: "12 Wattle St", suburb: null, postcode: null }, [clayton, { ...clayton, label: "12 Wattle St, Clayton 3168" }])).toMatchObject({ kind: "complete" });
    // A candidate that disagrees next to one that agrees does not block.
    expect(decideAddressCompletion({ addressLine: "12 Wattle St", suburb: null, postcode: null }, [nsw, clayton])).toMatchObject({ kind: "complete", suburb: "Clayton" });
  });

  test("shortlist, query, missing and the 7-day rule", () => {
    const stored = { addressLine: "12 wattle st", suburb: null, postcode: null };
    expect(shortlistLabels(stored, ["12 Wattle Street, Clayton VIC, Australia", "120 Wattle Street, Clayton VIC", "12 Wattle Grove, Mulgrave VIC", "Wattle Street, Clayton VIC", "12 Wattle St, Clayton North VIC", "12 Wattle St, Oakleigh VIC"]))
      .toEqual(["12 Wattle Street, Clayton VIC, Australia", "12 Wattle St, Clayton North VIC", "12 Wattle St, Oakleigh VIC"]); // max 3, number + name only
    expect(shortlistLabels({ ...stored, addressLine: "12 wattle st clayton" }, ["12 Wattle Street, Clayton VIC"])).toEqual(["12 Wattle Street, Clayton VIC"]);
    expect(shortlistLabels({ addressLine: "no number", suburb: null, postcode: null }, ["12 Wattle Street"])).toEqual([]);
    expect(lookupQuery({ addressLine: " 12  wattle st ", suburb: "Clayton", postcode: null })).toBe("12 wattle st Clayton");
    expect(lookupQuery({ addressLine: "12 wattle st", suburb: null, postcode: "3168" })).toBe("12 wattle st 3168");
    expect(addressMissing({ addressLine: "x", suburb: "Clayton", postcode: "3168" })).toBe(false);
    expect(addressMissing({ addressLine: "x", suburb: "Clayton", postcode: "0000" })).toBe(true);
    expect(addressMissing({ addressLine: "x", suburb: " ", postcode: "3168" })).toBe(true);
    const now = Date.parse("2026-10-25T00:00:00Z");
    expect(lookupDue(null, now)).toBe(true);
    expect(lookupDue("2026-10-20T00:00:00Z", now)).toBe(false);
    expect(lookupDue("2026-10-18T00:00:00Z", now)).toBe(true);
    expect(lookupDue("not a date", now)).toBe(true);
    expect(ADDRESS_LOOKUP_RETRY_DAYS).toBe(7);
    expect(ADDRESS_COMPLETE_BATCH).toBe(50);
  });
});

// ---------- server path: in-memory database, injected lookup ----------
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const updates: { table: string; patch: Row; id: unknown }[] = [];
const events: { jobId: string; type: string; summary: string; details: Row }[] = [];
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
function fakeAdmin() {
  return {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select"; let payload: Row | null = null; let lim = Infinity; let one = false;
      let orderBy: { col: string; asc: boolean } | null = null;
      const preds: ((r: Row) => boolean)[] = [];
      const b = {
        select() { return b; },
        eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
        is(c: string, v: null) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
        order(c: string, o?: { ascending?: boolean }) { orderBy ??= { col: c, asc: o?.ascending !== false }; return b; },
        limit(n: number) { lim = n; return b; },
        maybeSingle() { one = true; return b; },
        insert(p: Row) { op = "insert"; payload = p; return b; },
        update(p: Row) { op = "update"; payload = p; return b; },
        then(res: (v: { data: unknown; error: null }) => unknown, rej?: (e: unknown) => unknown) {
          let data: unknown = null;
          if (op === "insert") (tables[table] ??= []).push({ id: crypto.randomUUID(), ...payload! });
          else if (op === "update") { for (const r of (tables[table] ?? []).filter((r) => preds.every((p) => p(r)))) { Object.assign(r, payload!); updates.push({ table, patch: payload!, id: r["id"] }); } }
          else {
            let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
            if (orderBy) rows = [...rows].sort((x, y) => String(get(x, orderBy!.col)).localeCompare(String(get(y, orderBy!.col))) * (orderBy!.asc ? 1 : -1));
            rows = rows.slice(0, lim);
            data = one ? rows[0] ?? null : rows;
          }
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (jobId: string, _actor: unknown, type: string, summary: string, details: Row) => {
    events.push({ jobId, type, summary, details });
    (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id: jobId, event_type: type, created_at: new Date(NOW).toISOString(), details });
  },
}));
let lookedUp: string[] = [];
const NOW = Date.parse("2026-10-25T03:00:00Z");
const lookup = (results: Record<string, { id: string; label: string }[]>, details: Record<string, Row>) => ({
  search: async (q: string) => { lookedUp.push(q); return results[q] ?? []; },
  details: async (id: string) => (details[id] as never) ?? null,
});
const seed = () => {
  for (const k of Object.keys(tables)) delete tables[k];
  updates.length = 0; events.length = 0; lookedUp = [];
  const job = (id: string, created: string, p: Row, extra: Row = {}) => {
    tables["properties"] = [...(tables["properties"] ?? []), { id: `p-${id}`, ...p }];
    tables["owners"] = [...(tables["owners"] ?? []), { id: `o-${id}`, full_name: "jo" }];
    tables["jobs"] = [...(tables["jobs"] ?? []), { id, channel: "hivic_sourced", source: "base44", owner_id: `o-${id}`, property_id: `p-${id}`, owners: tables["owners"].at(-1), properties: tables["properties"].at(-1), ...extra }];
    tables["office_enquiry_index"] = [...(tables["office_enquiry_index"] ?? []), { id, created_at: created, office_bucket: "enquiry", channel: "hivic_sourced", source: "base44", deleted_at: null }];
  };
  job("j-blank", "2026-10-01T00:00:00Z", { address_line: "12 wattle st", suburb: null, postcode: null });
  job("j-baked", "2026-10-02T00:00:00Z", { address_line: "8 carrington rd box hill", suburb: null, postcode: null });
  job("j-complete", "2026-10-03T00:00:00Z", { address_line: "3 Lakeview Drive", suburb: "Lilydale", postcode: "3140" });
  job("j-recent", "2026-10-04T00:00:00Z", { address_line: "5 Nowhere Rd", suburb: null, postcode: null });
  tables["workflow_events"] = [{ id: "e1", job_id: "j-recent", event_type: "address_lookup_unresolved", created_at: "2026-10-23T00:00:00Z", details: {} }];
  job("j-installer", "2026-10-05T00:00:00Z", { address_line: "1 Typed As Is st", suburb: null, postcode: null }, { channel: "installer_sourced" });
  tables["office_enquiry_index"]!.at(-1)!["channel"] = "installer_sourced";
  job("j-nostreet", "2026-10-06T00:00:00Z", { address_line: "", suburb: null, postcode: null });
};
const RESULTS = {
  "12 wattle st": [{ id: "g1", label: "12 Wattle Street, Clayton VIC, Australia" }, { id: "g2", label: "12 Wattle Grove, Mulgrave VIC, Australia" }],
  "8 carrington rd box hill": [{ id: "g3", label: "8 Carrington Road, Box Hill VIC, Australia" }],
  "5 Nowhere Rd": [],
};
const DETAILS: Record<string, Row> = {
  g1: { label: "12 Wattle Street, Clayton VIC, Australia", street: "12 Wattle Street", suburb: "Clayton", postcode: "3168", state: "VIC" },
  g2: { label: "12 Wattle Grove, Mulgrave VIC, Australia", street: "12 Wattle Grove", suburb: "Mulgrave", postcode: "3170", state: "VIC" },
  g3: { label: "8 Carrington Road, Box Hill VIC, Australia", street: "8 Carrington Road", suburb: "Box Hill", postcode: "3128", state: "VIC" },
};

describe("address-complete server (decision 281)", () => {
  afterEach(() => { for (const k of Object.keys(tables)) delete tables[k]; });

  test("completes a blank suburb/postcode through the audited save and records address_completed", async () => {
    seed();
    const { completeJobAddress } = await import("../src/lib/address-complete.server");
    const r = await completeJobAddress("j-blank", { trigger: "intake", lookup: lookup(RESULTS, DETAILS) });
    expect(r).toEqual({ jobId: "j-blank", outcome: "completed", detail: "suburb,postcode,street" });
    expect(lookedUp).toEqual(["12 wattle st"]);
    expect(updates.find((u) => u.table === "properties")?.patch).toEqual({ address_line: "12 Wattle St", suburb: "Clayton", postcode: "3168", state: "VIC" });
    expect(updates.find((u) => u.table === "owners")?.patch).toEqual({ full_name: "Jo" }); // one-word name kept, tidied, never a blocker
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ jobId: "j-blank", type: "address_completed", details: { filled: ["suburb", "postcode", "street"], candidate: "12 Wattle Street, Clayton VIC, Australia", trigger: "intake", decision: 281, before: { suburb: null }, after: { suburb: "Clayton", postcode: "3168" } } });
    expect(events[0]!.summary).toContain("12 Wattle St, Clayton 3168");
  });

  test("splits a suburb baked into the street line without inventing anything", async () => {
    seed();
    const { completeJobAddress } = await import("../src/lib/address-complete.server");
    expect(await completeJobAddress("j-baked", { trigger: "tick", lookup: lookup(RESULTS, DETAILS) })).toMatchObject({ outcome: "completed" });
    expect(updates.find((u) => u.table === "properties")?.patch).toEqual({ address_line: "8 Carrington Rd", suburb: "Box Hill", postcode: "3128", state: "VIC" });
  });

  test("unresolved lookups are recorded once with the reason and never change the record", async () => {
    seed();
    const { completeJobAddress } = await import("../src/lib/address-complete.server");
    expect(await completeJobAddress("j-recent", { trigger: "tick", lookup: lookup(RESULTS, DETAILS) })).toEqual({ jobId: "j-recent", outcome: "unresolved", detail: "no_candidates" });
    expect(updates).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "address_lookup_unresolved", details: { reason: "no_candidates", query: "5 Nowhere Rd", trigger: "tick", stored: { addressLine: "5 Nowhere Rd" } } });
    // Ambiguous: two suburbs agree → unresolved with both candidates listed.
    const two = lookup({ "12 wattle st": [{ id: "g1", label: "12 Wattle Street, Clayton VIC, Australia" }, { id: "g4", label: "12 Wattle Street, Clayton North VIC, Australia" }] }, { ...DETAILS, g4: { label: "12 Wattle Street, Clayton North VIC, Australia", street: "12 Wattle Street", suburb: "Clayton North", postcode: "3168", state: "VIC" } });
    expect(await completeJobAddress("j-blank", { trigger: "tick", lookup: two })).toMatchObject({ outcome: "unresolved", detail: "ambiguous" });
    expect(updates).toHaveLength(0);
  });

  test("skips complete addresses, installer-entered addresses and missing jobs; a lookup failure never throws", async () => {
    seed();
    const { completeJobAddress } = await import("../src/lib/address-complete.server");
    const lk = lookup(RESULTS, DETAILS);
    expect(await completeJobAddress("j-complete", { trigger: "tick", lookup: lk })).toEqual({ jobId: "j-complete", outcome: "nothing_missing" });
    expect(await completeJobAddress("j-installer", { trigger: "tick", lookup: lk })).toMatchObject({ outcome: "skipped" });
    expect(await completeJobAddress("j-missing", { trigger: "tick", lookup: lk })).toMatchObject({ outcome: "skipped" });
    expect(lookedUp).toEqual([]);
    const broken = { search: async () => { throw new Error("provider down"); }, details: async () => null };
    expect(await completeJobAddress("j-blank", { trigger: "tick", lookup: broken })).toMatchObject({ outcome: "failed", detail: "provider down" });
    expect(events).toHaveLength(0); // a failed lookup is not an "unresolved" verdict; the next tick tries again
  });

  test("the tick: enquiry-stage jobs only, oldest first, 7-day rule, batch bound, counts only", async () => {
    seed();
    const { findIncompleteEnquiryAddresses, completeEnquiryAddresses } = await import("../src/lib/address-complete.server");
    // j-complete has nothing missing, j-recent was looked up 2 days ago, j-installer is installer-sourced, j-nostreet has no street.
    expect(await findIncompleteEnquiryAddresses(NOW)).toEqual(["j-blank", "j-baked"]);
    expect(await findIncompleteEnquiryAddresses(NOW, 1)).toEqual(["j-blank"]);
    expect(await findIncompleteEnquiryAddresses(NOW + 6 * 86_400_000)).toEqual(["j-blank", "j-baked", "j-recent"]);
    const out = await completeEnquiryAddresses({ lookup: lookup(RESULTS, DETAILS), now: NOW });
    expect(out).toEqual({ checked: 2, completed: 2, unresolved: 0, failed: 0 });
    expect(JSON.stringify(out)).not.toMatch(/wattle|carrington/i); // counts only, never PII
    // Both now carry an event and a complete address → the next tick has nothing to do.
    expect(await findIncompleteEnquiryAddresses(NOW)).toEqual([]);
  });

  test("wiring: the 15-minute tick runs the sweep; intake runs it for website/phone/email enquiries, never TEST or installer", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain('import("@/lib/address-complete.server")');
    expect(tick).toContain("completeEnquiryAddresses()");
    const intake = readFileSync("src/lib/enquiry.server.ts", "utf8");
    expect(intake).toMatch(/await completeAddressAtIntake\(job\.id, propFields, source, preserveEntered\)/);
    expect(intake).toMatch(/if \(preserveEntered \|\| source === "qa_test"\) return;/);
    const search = readFileSync("src/lib/address-search.functions.ts", "utf8");
    expect(search).toContain('import("./address-lookup.server")'); // Add a job and the sweep share one provider client
    expect(search).not.toContain("fetch(");
  });
});
