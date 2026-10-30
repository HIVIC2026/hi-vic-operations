// A48 batch 2, Task 2: office batch suggestions and the one-tap Send, on an in-memory fake database with recorded fake
// senders. Covers: who is a candidate (waiting website job, saved spot, likely eligible, not in an open batch, not
// closed, never installer-added), coordinates filled before clustering, installers listed only when they cover every
// home, Send = one event per job + the exact quick-taps text once per job (TEST → test-send), and one batch at a time.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AREA_BATCH_EVENTS, batchInstallers, openBatchId, quickTapsReminderText, quickTapsText, type BatchInstaller,
} from "../src/lib/area-batch.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES, brandSmsBody } from "../src/lib/sms.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const subset = (a: unknown, b: unknown): boolean => {
  if (b && typeof b === "object" && !Array.isArray(b)) return !!a && typeof a === "object" && Object.entries(b as Row).every(([k, v]) => subset((a as Row)[k], v));
  return a === b;
};
let clock = Date.parse("2026-10-30T00:00:00.000Z");
let failRead: string | null = null; // a table whose next select fails with a database error
function fakeAdmin() {
  return {
    from(table: string) {
      let op: "select" | "insert" | "update" = "select"; let payload: Row | null = null; let lim = Infinity; let head = false; let ret = false;
      const preds: ((r: Row) => boolean)[] = [];
      const b: Record<string, unknown> & PromiseLike<unknown> = {
        select(_c?: string, o?: { head?: boolean }) { if (op !== "select") ret = true; if (o?.head) head = true; return b; },
        eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
        neq(c: string, v: unknown) { preds.push((r) => get(r, c) !== v); return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
        is(c: string, v: unknown) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
        gte(c: string, v: string) { preds.push((r) => String(get(r, c)) >= v); return b; },
        contains(c: string, v: unknown) { preds.push((r) => subset(get(r, c), v)); return b; },
        order() { return b; }, range() { return b; },
        limit(n: number) { lim = n; return b; },
        maybeSingle() { lim = 1; (b as Row)["single1"] = true; return b; },
        single() { lim = 1; (b as Row)["single1"] = true; return b; },
        insert(p: Row) { op = "insert"; payload = p; return b; },
        update(p: Row) { op = "update"; payload = p; return b; },
        then(res, rej) {
          let out: { data: unknown; error: { message: string; code?: string } | null; count?: number };
          const one = (b as Row)["single1"] === true;
          if (op === "select" && failRead === table) { failRead = null; return Promise.resolve({ data: null, error: { message: "db down" } }).then(res, rej); }
          if (op === "insert") {
            const rows = (tables[table] ??= []);
            const det = (payload?.["details"] ?? {}) as Row;
            if (table === "workflow_events" && (AREA_BATCH_EVENTS as readonly string[]).includes(String(payload?.["event_type"])) && det["idempotency_key"] && rows.some((r) => r["event_type"] === payload?.["event_type"] && (r["details"] as Row)?.["idempotency_key"] === det["idempotency_key"]))
              out = { data: null, error: { message: "duplicate key", code: "23505" } };
            else { clock += 1000; const row = { id: crypto.randomUUID(), created_at: new Date(clock).toISOString(), ...payload! }; rows.push(row); out = { data: one ? row : [row], error: null }; }
          } else if (op === "update") {
            const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
            for (const r of hit) Object.assign(r, payload);
            out = { data: ret ? (one ? hit[0] ?? null : hit) : null, error: null };
          } else {
            const hit = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
            out = head ? { data: null, error: null, count: hit.length } : { data: one ? hit[0] ?? null : hit.slice(0, lim), error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));

const sent: { via: string; to: string; body: string; key?: string; type?: string }[] = [];
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (i: { type: string; to: string; body: string; idempotencyKey: string }) => { sent.push({ via: "real-sms", to: i.to, body: i.body, key: i.idempotencyKey, type: i.type }); return { status: "sent", detail: "ok", sid: "SM1" }; },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async () => { throw new Error("no email in Task 2"); },
  sendTestSms: async (_c: Row, to: string, body: string) => { sent.push({ via: "test-sms", to, body }); return { status: "sent", detail: "ok" }; },
}));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async (jobId: string) => `https://estimate.homeinsulationvictoria.com.au/my-job/T-${jobId}` }));
// Coordinates lookup (Vicmap → Google Places) is stubbed: it records the call and stores the fact like the real one.
const located: string[] = [];
mock.module("../src/lib/property-coordinates.server", () => ({
  ensurePropertyCoordinates: async (jobId: string, propertyId: string) => {
    located.push(jobId);
    const c = lookupCoords[propertyId];
    if (!c) return null;
    tables["property_facts"]!.push({ property_id: propertyId, fact_key: "coordinates", value: c, is_current: true });
    return c;
  },
}));
const lookupCoords: Record<string, [number, number]> = {};

function installer(o: Partial<BatchInstaller> = {}): BatchInstaller {
  return {
    id: "biz-1", name: "Sample Insulation", is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true,
    coverage_verified_at: "2026-10-01T00:00:00Z", service_postcodes: ["3000", "3001"], free_measureups_for_hivic_quote_leads: true, onboarding_notes: null,
    credentialsOk: true, fullCertifiedInstallers: 1, covers_all_victoria: false, ...o,
  };
}
let installers: BatchInstaller[] = [];
mock.module("../src/lib/installer-waiting.server", () => ({ installerFacts: async () => installers }));

const S = await import("../src/lib/area-batch.server");

// ---- fixtures ---------------------------------------------------------------------------------------------------
const NOW = new Date("2026-10-30T01:00:00.000Z"); // 12pm Melbourne — outside quiet hours
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const pt = (northKm: number): [number, number] => [145, -37.8 + northKm / 111.19]; // stored [lng, lat]
const GOOD = { declared: { property_type: "house", over_five_years: "yes" }, answers: { insulation: "none" } };

function addJob(id: string, o: { postcode?: string; source?: string | null; channel?: string; stage?: string; facts?: Row; coords?: [number, number] | null; waited?: number; saved?: boolean; roof?: string; deleted?: boolean } = {}) {
  const prop = `p-${id}`;
  tables["jobs"]!.push({
    id, job_number: `HV-${id}`, stage: o.stage ?? "ready_check_ready_to_schedule", source: o.source ?? "website", channel: o.channel ?? "hivic_sourced",
    deleted_at: o.deleted ? "2026-10-29T00:00:00Z" : null, qa_archived_at: null, property_id: prop, created_at: daysAgo(30),
    owners: { full_name: `Owner ${id}`, phone: "0400000000" },
    properties: { suburb: "Melbourne", postcode: o.postcode ?? "3000", ...(o.facts ?? GOOD) },
  });
  if (o.saved !== false) tables["lead_campaign_responses"]!.push({ job_id: id, spot_saved_at: daysAgo(o.waited ?? 1), opted_out_at: null, saved_insulation: null });
  if (o.coords !== null) tables["property_facts"]!.push({ property_id: prop, fact_key: "coordinates", value: o.coords ?? pt(0), is_current: true });
  if (o.roof) tables["property_facts"]!.push({ property_id: prop, fact_key: "roof_form", value: o.roof, is_current: true });
}
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(lookupCoords)) delete lookupCoords[k];
  sent.length = 0; located.length = 0;
  for (const t of ["jobs", "lead_campaign_responses", "property_facts", "job_assignments", "partner_offers", "workflow_events", "rate_cards"]) tables[t] = [];
  tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { quick_taps: true } }];
  tables["businesses"] = [{ id: "biz-1", name: "Sample Insulation", trading_name: null, onboarding_notes: null }, { id: "biz-t", name: "[TEST PARTNER] Co", trading_name: null, onboarding_notes: "[TEST PARTNER]" }];
  tables["rate_cards"] = [{ id: "rc-1", business_id: "biz-1", kind: "installer", is_active: true }, { id: "rc-t", business_id: "biz-t", kind: "installer", is_active: true }];
  installers = [installer()];
}
const events = (type?: string) => (tables["workflow_events"] ?? []).filter((e) => !type || e["event_type"] === type);
const ids = (n: number, p = "j") => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);

// ---- wording + switches -----------------------------------------------------------------------------------------
describe("quick taps texts", () => {
  test("exact owner wording (Jo approved 30 Oct 2026)", () => {
    expect(quickTapsText("Helen Sample", "https://x/my-job/T?screen=taps")).toBe("Hi Helen, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote: https://x/my-job/T?screen=taps - Home Insulation Victoria");
    expect(quickTapsReminderText("Helen Sample", "L")).toBe("Hi Helen, just a reminder - please confirm a few quick details so we can book your free Ready Check: L");
  });
  test("no name → \"Hi there,\" (Jo approved)", () => {
    expect(quickTapsText(null, "L")).toBe("Hi there, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote: L - Home Insulation Victoria");
    expect(quickTapsReminderText("  ", "L")).toBe("Hi there, just a reminder - please confirm a few quick details so we can book your free Ready Check: L");
  });
  test("the sender never adds a second brand to a text already signed by Home Insulation Victoria", () => {
    const t = quickTapsText("Helen", "L");
    expect(brandSmsBody(t)).toBe(t);
  });
  test("both new types are owner texts with their own switch (off unless switched on), quiet hours apply", () => {
    for (const k of ["quick_taps", "quick_taps_reminder"] as const) {
      expect(SMS_MESSAGE_TYPES[k].audience).toBe("owner");
      expect(SMS_MESSAGE_TYPES[k].quietHours).toBe(true);
      expect(SMS_FRESHNESS[k]).toEqual({ kind: "window" });
    }
  });
});

// ---- pure: open batch + covering installers ----------------------------------------------------------------------
describe("openBatchId", () => {
  const e = (t: string, b: string, at: string) => ({ event_type: t, created_at: at, details: { batch_id: b } });
  test("sent and not closed → open; closed → none; a later batch after a closed one → the later one", () => {
    expect(openBatchId([])).toBeNull();
    expect(openBatchId([e("area_batch_sent", "b1", "1")])).toBe("b1");
    expect(openBatchId([e("area_batch_sent", "b1", "1"), e("area_batch_closed", "b1", "2")])).toBeNull();
    expect(openBatchId([e("area_batch_sent", "b1", "1"), e("area_batch_closed", "b1", "2"), e("area_batch_sent", "b2", "3")])).toBe("b2");
  });
});
describe("batchInstallers", () => {
  const home = (postcode: string) => ({ postcode, isTest: false });
  test("only installers covering EVERY home", () => {
    const a = installer({ id: "a", service_postcodes: ["3000", "3001"] });
    const b = installer({ id: "b", service_postcodes: ["3000"] });
    expect(batchInstallers([a, b], [home("3000"), home("3001")]).map((i) => i.id)).toEqual(["a"]);
  });
  test("anywhere in Victoria counts only with office-verified coverage", () => {
    const all = installer({ id: "v", service_postcodes: [], covers_all_victoria: true });
    const unverified = installer({ id: "u", service_postcodes: [], covers_all_victoria: true, coverage_verified_at: null });
    expect(batchInstallers([all, unverified], [home("3000"), home("3550")]).map((i) => i.id)).toEqual(["v"]);
    expect(batchInstallers([all], [home("2600")])).toEqual([]);
  });
  test("a blocked installer (not approved) is never listed", () =>
    expect(batchInstallers([installer({ onboarding_status: "pending" })], [home("3000")])).toEqual([]));
});

// ---- candidates ---------------------------------------------------------------------------------------------------
describe("batchCandidates", () => {
  beforeEach(seed);
  test("a waiting website job with a saved spot and likely eligible answers is a candidate", async () => {
    addJob("ok");
    const r = await S.batchCandidates({ now: NOW });
    expect(r.candidates.map((c) => c.jobId)).toEqual(["ok"]);
    expect(r.candidates[0]).toMatchObject({ postcode: "3000", isTest: false, lat: -37.8, lng: 145 });
  });
  test("left out: installer-added, no saved spot, not likely eligible, flat roof, closed, deleted, has an installer, TEST (unless asked)", async () => {
    addJob("installer", { channel: "installer_sourced" });
    addJob("nospot", { saved: false });
    addJob("notlikely", { facts: { declared: { property_type: "house", over_five_years: "no" }, answers: { insulation: "none" } } });
    addJob("flat", { roof: "low_slope_flat" });
    addJob("closed", { stage: "cancelled" });
    addJob("deleted", { deleted: true });
    addJob("assigned"); tables["job_assignments"]!.push({ job_id: "assigned", role: "installer", active: true });
    addJob("test", { source: "qa_test" });
    addJob("ok");
    expect((await S.batchCandidates({ now: NOW })).candidates.map((c) => c.jobId)).toEqual(["ok"]);
    expect((await S.batchCandidates({ now: NOW, includeTest: true })).candidates.map((c) => c.jobId).sort()).toEqual(["ok", "test"]);
  });
  test("thin existing insulation and a top-floor unit are candidates (website answers)", async () => {
    addJob("thin", { facts: { declared: { property_type: "house", over_five_years: "yes" }, answers: { insulation: "yes", insulation_thickness: "thin" } } });
    addJob("unit", { facts: { declared: { property_type: "apartment", over_five_years: "yes" }, answers: { insulation: "none", top_floor: "yes" } } });
    expect((await S.batchCandidates({ now: NOW })).candidates.map((c) => c.jobId).sort()).toEqual(["thin", "unit"]);
  });
  test("a job already in an open batch is not a candidate; once its batch closes it is again", async () => {
    addJob("a");
    tables["workflow_events"]!.push({ job_id: "a", event_type: "area_batch_sent", created_at: daysAgo(1), details: { batch_id: "b1" } });
    expect((await S.batchCandidates({ now: NOW })).candidates).toEqual([]);
    tables["workflow_events"]!.push({ job_id: "a", event_type: "area_batch_closed", created_at: daysAgo(0.5), details: { batch_id: "b1" } });
    expect((await S.batchCandidates({ now: NOW })).candidates.map((c) => c.jobId)).toEqual(["a"]);
  });
  test("a job whose owner is being asked to confirm a released spot is not a candidate", async () => {
    addJob("rel");
    tables["workflow_events"]!.push({ job_id: "rel", event_type: "spot_released", created_at: daysAgo(1), details: { release_seq: 1, business_id: "biz-1" } });
    expect((await S.batchCandidates({ now: NOW })).candidates).toEqual([]);
  });
  test("coordinates are filled (ensurePropertyCoordinates) before clustering; a home still not found is left out", async () => {
    addJob("found", { coords: null }); lookupCoords["p-found"] = pt(1);
    addJob("lost", { coords: null });
    const r = await S.batchCandidates({ now: NOW });
    expect(located.sort()).toEqual(["found", "lost"]);
    expect(r.candidates.map((c) => c.jobId)).toEqual(["found"]);
    expect(r.unlocated).toBe(1);
  });
});

// ---- suggestions ----------------------------------------------------------------------------------------------------
describe("batchSuggestions", () => {
  beforeEach(seed);
  test("8 nearby homes → one suggestion with suburbs, span and the installers covering every home", async () => {
    for (const [i, id] of ids(8).entries()) addJob(id, { coords: pt(i * 0.5), postcode: i < 4 ? "3000" : "3001" });
    installers = [installer({ id: "biz-1" }), installer({ id: "biz-2", name: "Only 3000", service_postcodes: ["3000"] })];
    const r = await S.batchSuggestions({ now: NOW });
    expect(r.batches.length).toBe(1);
    const b = r.batches[0]!;
    expect(b.homes.length).toBe(8);
    expect(b.suburbs).toEqual(["Melbourne 3000", "Melbourne 3001"]);
    expect(b.spanKm).toBe(3.5);
    expect(b.installers).toEqual([{ id: "biz-1", name: "Sample Insulation" }]);
  });
  test("too few homes and none waited 14 days → no suggestion", async () => {
    for (const id of ids(3)) addJob(id);
    expect((await S.batchSuggestions({ now: NOW })).batches).toEqual([]);
  });
  test("TEST and real homes are never in the same suggestion", async () => {
    for (const id of ids(8)) addJob(id);
    for (const id of ids(8, "t")) addJob(id, { source: "qa_test" });
    installers = [installer(), installer({ id: "biz-t", name: "[TEST PARTNER] Co", onboarding_notes: "[TEST PARTNER]" })];
    const r = await S.batchSuggestions({ now: NOW, includeTest: true });
    expect(r.batches.length).toBe(2);
    for (const b of r.batches) expect(new Set(b.homes.map((h) => h.isTest)).size).toBe(1);
    expect(r.batches.find((b) => b.isTest)!.installers.map((i) => i.id)).toEqual(["biz-t"]);
    expect(r.batches.find((b) => !b.isTest)!.installers.map((i) => i.id)).toEqual(["biz-1"]);
  });
});

// ---- Send ---------------------------------------------------------------------------------------------------------
describe("sendBatch", () => {
  beforeEach(seed);
  test("one event per job and the exact quick-taps text once per job (real → the one real sender, quick_taps type)", async () => {
    for (const id of ids(8)) addJob(id);
    const r = await S.sendBatch(ids(8), "biz-1", "jo", { now: NOW });
    const ev = events("area_batch_sent");
    expect(ev.length).toBe(8);
    expect(new Set(ev.map((e) => (e["details"] as Row)["batch_id"])).size).toBe(1);
    for (const e of ev) expect(e["details"]).toMatchObject({ batch_id: r.batchId, installer_business_id: "biz-1", job_ids: ids(8) });
    expect(ev.map((e) => e["job_id"]).sort()).toEqual(ids(8).sort());
    expect(sent.length).toBe(8);
    expect(sent.every((s) => s.via === "real-sms" && s.type === "quick_taps")).toBe(true);
    expect(sent.find((s) => s.key === `quick-taps:v1:${r.batchId}:j1:sent`)!.body)
      .toBe("Hi Owner, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote: https://estimate.homeinsulationvictoria.com.au/my-job/T-j1?screen=taps - Home Insulation Victoria");
    expect(new Set(sent.map((s) => s.key)).size).toBe(8);
  });
  test("TEST jobs go through test-send, never the real sender", async () => {
    for (const id of ids(2, "t")) addJob(id, { source: "qa_test" });
    installers = [installer({ id: "biz-t", name: "[TEST PARTNER] Co", onboarding_notes: "[TEST PARTNER]" })];
    await S.sendBatch(ids(2, "t"), "biz-t", "jo", { now: NOW });
    expect(sent.map((s) => s.via)).toEqual(["test-sms", "test-sms"]);
    expect(events("area_batch_sent").length).toBe(2);
  });
  test("one batch at a time: a Send including a job already in an open batch is refused, nothing sent", async () => {
    for (const id of ids(3)) addJob(id);
    await S.sendBatch(["j1"], "biz-1", "jo", { now: NOW });
    sent.length = 0;
    await expect(S.sendBatch(["j2", "j1", "j3"], "biz-1", "jo", { now: NOW })).rejects.toThrow(/HV-j1 is already in a batch/);
    expect(sent.length).toBe(0);
    expect(events("area_batch_sent").map((e) => e["job_id"])).toEqual(["j1"]);
    expect(await S.openBatchFor("j2")).toBeNull();
    expect(await S.openBatchFor("j1")).toBe((events("area_batch_sent")[0]!["details"] as Row)["batch_id"] as string);
  });
  test("installer-added job → refused, nothing recorded or sent", async () => {
    addJob("j1"); addJob("inst", { channel: "installer_sourced" });
    await expect(S.sendBatch(["j1", "inst"], "biz-1", "jo", { now: NOW })).rejects.toThrow(/HV-inst can't be put in a batch/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
  test("installer not covering every home → refused, nothing recorded or sent", async () => {
    addJob("j1"); addJob("far", { postcode: "3550" });
    await expect(S.sendBatch(["j1", "far"], "biz-1", "jo", { now: NOW })).rejects.toThrow(/doesn't cover every home/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
  test("real homes while the quick taps texts are switched off → refused, nothing recorded", async () => {
    addJob("j1");
    tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: {} }];
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: NOW })).rejects.toThrow(/switched off/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
  test("real homes during quiet hours (8pm–7am) → refused, nothing recorded", async () => {
    addJob("j1");
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: new Date("2026-10-30T11:00:00Z") })).rejects.toThrow(/7am/);
    expect(events().length).toBe(0);
  });
  test("a TEST and a real home together → refused", async () => {
    addJob("j1"); addJob("t1", { source: "qa_test" });
    await expect(S.sendBatch(["j1", "t1"], "biz-1", "jo", { now: NOW })).rejects.toThrow(/TEST/);
    expect(events().length).toBe(0);
  });
  test("installer with no rate card → refused (decision 399)", async () => {
    addJob("j1"); tables["rate_cards"] = [];
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: NOW })).rejects.toThrow(/rate card/);
    expect(events().length).toBe(0);
  });
});

describe("brand line", () => {
  test("older texts ending with an en dash sign-off still get the brand line first (unchanged)", () =>
    expect(brandSmsBody("Spot saved! Your job: L – Home Insulation Victoria")).toBe("Home Insulation Victoria: Spot saved! Your job: L – Home Insulation Victoria"));
  test("the day-2 reminder (no sign-off) gets the brand line first", () =>
    expect(brandSmsBody(quickTapsReminderText("Helen", "L"))).toBe("Home Insulation Victoria: Hi Helen, just a reminder - please confirm a few quick details so we can book your free Ready Check: L"));
});

// ---- review fix round 1 -----------------------------------------------------------------------------------------------
describe("TEST office login", () => {
  test("suggested batches are hidden for the TEST office login (its functions are not on the TEST office allowlist)", async () => {
    const { showAreaBatches } = await import("../src/lib/area-batch.core");
    const { qaOfficeFunctionAllowed } = await import("../src/lib/qa-office-policy.core");
    expect(qaOfficeFunctionAllowed("src/lib/area-batch.functions.ts", "getAreaBatchSuggestions")).toBe(false);
    expect(showAreaBatches(["qa_office"])).toBe(false);
    expect(showAreaBatches(["admin", "qa_office"])).toBe(false);
    expect(showAreaBatches(["admin"])).toBe(true);
    expect(showAreaBatches(undefined)).toBe(false); // not known yet → nothing loads
    const src = await Bun.file("src/components/portal/InstallerWaitingScreen.tsx").text();
    expect(src).toMatch(/showAreaBatches\(me\?\.roles\) && <AreaBatchSuggestions/);
  });
});
describe("sendBatch review fixes", () => {
  beforeEach(seed);
  test("TEST texts carry the office user who tapped Send", async () => {
    const ctxs: Row[] = [];
    mock.module("../src/lib/test-send.server", () => ({
      sendTestEmail: async () => { throw new Error("no email"); },
      sendTestSms: async (c: Row, to: string, body: string) => { ctxs.push(c); sent.push({ via: "test-sms", to, body }); return { status: "sent", detail: "ok" }; },
    }));
    addJob("t1", { source: "qa_test" });
    installers = [installer({ id: "biz-t", name: "[TEST PARTNER] Co", onboarding_notes: "[TEST PARTNER]" })];
    await S.sendBatch(["t1"], "biz-t", "jo", { now: NOW });
    expect(ctxs[0]!["actorId"]).toBe("jo");
  });
  test("job number lookup failing → refused clearly, nothing recorded or sent", async () => {
    addJob("j1");
    failRead = "jobs";
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: NOW })).rejects.toThrow(/Could not read the jobs: db down/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
});
