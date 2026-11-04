// A48 batch 2, Task 2: office batch suggestions and the one-tap Send, on an in-memory fake database with recorded fake
// senders. Covers: who is a candidate (waiting website job, saved spot, likely eligible, not in an open batch, not
// closed, never installer-added), coordinates filled before clustering, installers listed only when they cover every
// home, Send = one event per job + the exact quick-taps text once per job (TEST → test-send), and one batch at a time.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  AREA_BATCH_EVENTS, batchInstallers, openBatchId, quickTapsReminderText, quickTapsText, type BatchInstaller,
} from "../src/lib/area-batch.core";
import { readFileSync } from "node:fs";
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
const emails: { via: string; to: string; purpose?: string; key?: string; subject: string; text: string }[] = [];
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (_c: Row, to: string, subject: string, _html: string, text: string) => { emails.push({ via: "test-email", to, subject, text }); return { status: "sent", detail: "ok" }; },
  sendTestSms: async (_c: Row, to: string, body: string) => { sent.push({ via: "test-sms", to, body }); return { status: "sent", detail: "ok" }; },
}));
// Owner contact consent (final review 1): like the live check, no granted consent row → the email is held.
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async (jobId: string, what: string) => {
  if (!(tables["owner_contact_consents"] ?? []).some((c) => c["job_id"] === jobId && c["consent_status"] === "granted")) throw new Error(`No contact consent from the owner on record – nothing was sent to the customer. (${what})`);
} }));
// Real owner emails: the one guarded sender, recorded (its once-only key, opt-outs and suppression are its own job).
let guarded: string | Error = "sent";
let guardedOpts: { explainBlock?: boolean }[] = [];
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { to: string; purpose: string; key: string; explainBlock?: boolean; build: (u: string | null) => { subject: string; html: string; text: string } }) => {
    guardedOpts.push({ explainBlock: p.explainBlock });
    if (guarded instanceof Error) throw guarded;
    const m = p.build("https://unsub.example/u");
    emails.push({ via: "real-email", to: p.to, purpose: p.purpose, key: p.key, subject: m.subject, text: m.text });
    return guarded;
  },
}));
// Like the live link rule (trg_owner_links_follow_cancel): a cancelled job's link is revoked, so no working link.
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async (jobId: string) => tables["jobs"]?.find((j) => j["id"] === jobId)?.["stage"] === "cancelled" ? null : `https://estimate.homeinsulationvictoria.com.au/my-job/T-${jobId}` }));
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

const reopens: string[] = [];
mock.module("../src/lib/office-actions.server", () => ({
  // Like the real reopenJob: the stage moves and a stage_changed event is logged.
  reopenJob: async (jobId: string) => {
    reopens.push(jobId); tables["jobs"]!.find((r) => r["id"] === jobId)!["stage"] = "ready_check_ready_to_schedule";
    clock += 1000; tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: jobId, event_type: "stage_changed", created_at: new Date(clock).toISOString(), details: { to_stage: "ready_check_ready_to_schedule" } });
  },
}));
const S = await import("../src/lib/area-batch.server");

// ---- fixtures ---------------------------------------------------------------------------------------------------
const NOW = new Date("2026-10-30T01:00:00.000Z"); // 12pm Melbourne — outside quiet hours
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const pt = (northKm: number): [number, number] => [145, -37.8 + northKm / 111.19]; // stored [lng, lat]
const GOOD = { declared: { property_type: "house", over_five_years: "yes" }, answers: { insulation: "none" } };

function addJob(id: string, o: { consent?: boolean; email?: string | null; postcode?: string; source?: string | null; channel?: string; stage?: string; facts?: Row; coords?: [number, number] | null; waited?: number; saved?: boolean; roof?: string; deleted?: boolean } = {}) {
  const prop = `p-${id}`;
  tables["jobs"]!.push({
    id, job_number: `HV-${id}`, stage: o.stage ?? "ready_check_ready_to_schedule", source: o.source ?? "website", channel: o.channel ?? "hivic_sourced",
    deleted_at: o.deleted ? "2026-10-29T00:00:00Z" : null, qa_archived_at: null, property_id: prop, created_at: daysAgo(30),
    owners: { full_name: `Owner ${id}`, phone: "0400000000", email: o.email === undefined ? `owner-${id}@example.com` : o.email },
    properties: { address_line: "1 Sample Street", suburb: "Melbourne", postcode: o.postcode ?? "3000", ...(o.facts ?? GOOD) },
  });
  // Final review 1: owner contact consent on record (real jobs need it before any email).
  if (o.consent !== false) (tables["owner_contact_consents"] ??= []).push({ job_id: id, consent_status: "granted", created_at: daysAgo(30) });
  if (o.saved !== false) tables["lead_campaign_responses"]!.push({ job_id: id, spot_saved_at: daysAgo(o.waited ?? 1), opted_out_at: null, saved_insulation: null });
  if (o.coords !== null) tables["property_facts"]!.push({ property_id: prop, fact_key: "coordinates", value: o.coords ?? pt(0), is_current: true });
  if (o.roof) tables["property_facts"]!.push({ property_id: prop, fact_key: "roof_form", value: o.roof, is_current: true });
}
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  for (const k of Object.keys(lookupCoords)) delete lookupCoords[k];
  sent.length = 0; emails.length = 0; located.length = 0; guarded = "sent"; guardedOpts = [];
  for (const t of ["jobs", "lead_campaign_responses", "property_facts", "job_assignments", "partner_offers", "workflow_events", "rate_cards"]) tables[t] = [];
  tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { spot_released: true, quick_taps: true } }];
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
  test("left out: installer-added, no saved spot, closed, deleted, has an installer, TEST (unless asked)", async () => {
    addJob("installer", { channel: "installer_sourced" });
    addJob("nospot", { saved: false });
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

// ---- Send ---------------------------------------------------------------------------------------------------------
describe("sendBatch", () => {
  beforeEach(seed);
  test("one event per job, then ONE owner email (purpose spot_released) and ONE spot_released text per home; no quick_taps text", async () => {
    for (const id of ids(8)) addJob(id);
    const r = await S.sendBatch(ids(8), "biz-1", "jo", { now: NOW, v2Approved: true });
    const ev = events("area_batch_sent");
    expect(ev.length).toBe(8);
    expect(new Set(ev.map((e) => (e["details"] as Row)["batch_id"])).size).toBe(1);
    for (const e of ev) expect(e["details"]).toMatchObject({ batch_id: r.batchId, installer_business_id: "biz-1", job_ids: ids(8), owner_message: "spot_released" });
    // Task 3: the batch centre (first home, as suggestBatches lists it) and its location are kept for a moved address.
    for (const e of ev) expect(e["details"]).toMatchObject({ centre_job_id: "j1", centre: { lat: -37.8, lng: 145 } });
    expect(ev.map((e) => e["job_id"]).sort()).toEqual(ids(8).sort());
    expect(sent.length).toBe(8);
    expect(sent.every((x) => x.via === "real-sms" && x.type === "spot_released")).toBe(true);
    expect(sent.some((x) => x.type === "quick_taps")).toBe(false);
    expect(sent.find((x) => x.key === `spot-release:v1:j1:${r.batchId}:released:sms`)!.body)
      .toBe("Home Insulation Victoria: Hi Owner, it's your turn! Confirm a few quick details for your free Ready Check: https://estimate.homeinsulationvictoria.com.au/my-job/T-j1?screen=taps");
    expect(new Set(sent.map((x) => x.key)).size).toBe(8);
    expect(emails.length).toBe(8);
    expect(emails.every((m) => m.via === "real-email" && m.purpose === "spot_released")).toBe(true);
    const m1 = emails.find((m) => m.key === `spot-release:v1:j1:${r.batchId}:released`)!;
    expect(m1.to).toBe("owner-j1@example.com");
    expect(m1.text).toContain("Confirm my details: https://estimate.homeinsulationvictoria.com.au/my-job/T-j1?screen=taps");
    expect(m1.text).toContain("Answer a few quick questions so we can book your free Ready Check.");
  });
  test("IT_IS_YOUR_TURN_V2_APPROVED is false in the code: a real batch is refused, nothing recorded or sent", async () => {
    addJob("j1");
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: NOW })).rejects.toThrow("It's your turn wording not switched on yet");
    expect(events().length).toBe(0); expect(sent.length).toBe(0); expect(emails.length).toBe(0);
  });
  test("TEST jobs go through test-send, never the real sender", async () => {
    for (const id of ids(2, "t")) addJob(id, { source: "qa_test" });
    installers = [installer({ id: "biz-t", name: "[TEST PARTNER] Co", onboarding_notes: "[TEST PARTNER]" })];
    await S.sendBatch(ids(2, "t"), "biz-t", "jo", { now: NOW }); // TEST jobs ignore the approval flag
    expect(sent.map((s) => s.via)).toEqual(["test-sms", "test-sms"]);
    expect(emails.map((m) => m.via)).toEqual(["test-email", "test-email"]);
    expect(events("area_batch_sent").length).toBe(2);
  });
  test("one batch at a time: a Send including a job already in an open batch is refused, nothing sent", async () => {
    for (const id of ids(3)) addJob(id);
    await S.sendBatch(["j1"], "biz-1", "jo", { now: NOW, v2Approved: true });
    sent.length = 0;
    await expect(S.sendBatch(["j2", "j1", "j3"], "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/HV-j1 is already in a batch/);
    expect(sent.length).toBe(0);
    expect(events("area_batch_sent").map((e) => e["job_id"])).toEqual(["j1"]);
    expect(await S.openBatchFor("j2")).toBeNull();
    expect(await S.openBatchFor("j1")).toBe((events("area_batch_sent")[0]!["details"] as Row)["batch_id"] as string);
  });
  test("installer-added job → refused, nothing recorded or sent", async () => {
    addJob("j1"); addJob("inst", { channel: "installer_sourced" });
    await expect(S.sendBatch(["j1", "inst"], "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/HV-inst can't be put in a batch/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
  test("installer not covering every home → refused, nothing recorded or sent", async () => {
    addJob("j1"); addJob("far", { postcode: "3550" });
    await expect(S.sendBatch(["j1", "far"], "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/doesn't cover every home/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
  test("real homes while the It's your turn texts are switched off → refused, nothing recorded", async () => {
    addJob("j1");
    tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: {} }];
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/switched off/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
  test("real homes during quiet hours (8pm–7am) → refused, nothing recorded", async () => {
    addJob("j1");
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: new Date("2026-10-30T11:00:00Z"), v2Approved: true })).rejects.toThrow(/7am/);
    expect(events().length).toBe(0);
  });
  test("a TEST and a real home together → refused", async () => {
    addJob("j1"); addJob("t1", { source: "qa_test" });
    await expect(S.sendBatch(["j1", "t1"], "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/TEST/);
    expect(events().length).toBe(0);
  });
  test("installer with no rate card → refused (decision 399)", async () => {
    addJob("j1"); tables["rate_cards"] = [];
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/rate card/);
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
  test("area batches are hidden for the TEST office login (its functions are not on the TEST office allowlist)", async () => {
    const { showAreaBatches } = await import("../src/lib/area-batch.core");
    const { qaOfficeFunctionAllowed } = await import("../src/lib/qa-office-policy.core");
    expect(qaOfficeFunctionAllowed("src/lib/area-batch.functions.ts", "sendAreaBatchFn")).toBe(false);
    expect(showAreaBatches(["qa_office"])).toBe(false);
    expect(showAreaBatches(["admin", "qa_office"])).toBe(false);
    expect(showAreaBatches(["admin"])).toBe(true);
    expect(showAreaBatches(undefined)).toBe(false); // not known yet → nothing loads
    const src = await Bun.file("src/components/portal/InstallerWaitingScreen.tsx").text();
    expect(src).toMatch(/showAreaBatches\(me\?\.roles\) && <BatchesReadyToSend/);
    expect(src).not.toMatch(/AreaBatchSuggestions/); // Saved spots by area (3 Nov 2026): the Suggested batches box is gone
  });
});
describe("sendBatch: an owner carrying a pass from a batch they left (Task 4 fix round 1)", () => {
  beforeEach(seed);
  test("recorded in the new batch (carried_pass) but not messaged again; the others get their text", async () => {
    addJob("d"); addJob("e");
    const old = (t: string, details: Row) => tables["workflow_events"]!.push({ job_id: "d", event_type: t, created_at: daysAgo(5), details });
    old("area_batch_sent", { batch_id: "b0", job_ids: ["d"] });
    old("area_batch_left", { batch_id: "b0", reason: "address_moved" });
    old("quick_taps_answered", { batch_id: "b0", outcome: "pass" });
    const r = await S.sendBatch(["d", "e"], "biz-1", "jo", { now: NOW, v2Approved: true });
    const d = events("area_batch_sent").find((e) => e["job_id"] === "d" && (e["details"] as Row)["batch_id"] === r.batchId)!;
    expect(d["details"]).toMatchObject({ carried_pass: true });
    const e = events("area_batch_sent").find((x) => x["job_id"] === "e")!;
    expect((e["details"] as Row)["carried_pass"]).toBeUndefined();
    expect(sent.map((x) => x.to.length > 0 && x.body.includes("T-e"))).toEqual([true]);
    expect(r.texts.find((t) => t.jobId === "d")).toMatchObject({ status: "not_texted" });
    expect(emails.map((m) => m.to)).toEqual(["owner-e@example.com"]);
  });
});

describe("sendBatch review fixes", () => {
  beforeEach(seed);
  test("TEST texts carry the office user who tapped Send", async () => {
    const ctxs: Row[] = [];
    mock.module("../src/lib/test-send.server", () => ({
      sendTestEmail: async () => ({ status: "sent", detail: "ok" }),
      sendTestSms: async (c: Row, to: string, body: string) => { ctxs.push(c); sent.push({ via: "test-sms", to, body }); return { status: "sent", detail: "ok" }; },
    }));
    addJob("t1", { source: "qa_test" });
    installers = [installer({ id: "biz-t", name: "[TEST PARTNER] Co", onboarding_notes: "[TEST PARTNER]" })];
    await S.sendBatch(["t1"], "biz-t", "jo", { now: NOW, v2Approved: true });
    expect(ctxs[0]!["actorId"]).toBe("jo");
  });
  test("job number lookup failing → refused clearly, nothing recorded or sent", async () => {
    addJob("j1");
    failRead = "jobs";
    await expect(S.sendBatch(["j1"], "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/Could not read the jobs: db down/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
});

// ---- Jo 2 Nov 2026: the owner email goes with the text (ported at the 4 Nov join to the O77 "It's your turn" email, decision #22) ----
const V2 = { now: NOW, v2Approved: true };
describe("sendBatch: the It's your turn email with the text", () => {
  const testEmails: { to: string; subject: string; text: string; label: string }[] = [];
  beforeEach(() => {
    seed(); testEmails.length = 0;
    mock.module("../src/lib/test-send.server", () => ({
      sendTestEmail: async (c: { label: string }, to: string, subject: string, _html: string, text: string) => { testEmails.push({ to, subject, text, label: c.label }); return { status: "sent", detail: "ok" }; },
      sendTestSms: async (_c: Row, to: string, body: string) => { sent.push({ via: "test-sms", to, body }); return { status: "sent", detail: "ok" }; },
    }));
  });
  test("sendBatch emails and texts each home", async () => {
    addJob("j1", { email: "one@example.com" }); addJob("j2", { email: "two@example.com" });
    const r = await S.sendBatch(["j1", "j2"], "biz-1", "jo", V2);
    expect(sent.length).toBe(2);
    expect(emails.map((e) => e.key).sort()).toEqual([`spot-release:v1:j1:${r.batchId}:released`, `spot-release:v1:j2:${r.batchId}:released`]);
    const e1 = emails.find((e) => e.to === "one@example.com")!;
    expect(e1.purpose).toBe("spot_released");
    expect(e1.subject).toBe("It's your turn — confirm your free Ready Check");
    const link = "https://estimate.homeinsulationvictoria.com.au/my-job/T-j1?screen=taps";
    expect(sent.find((x) => x.body.includes("T-j1"))!.body).toContain(link);
    expect(e1.text).toContain(link);
    expect(r.texts.map((t) => [t.jobId, t.status, t.email.status]).sort()).toEqual([["j1", "sent", "sent"], ["j2", "sent", "sent"]]);
  });
  test("no email on file → text only", async () => {
    addJob("j1", { email: null }); addJob("j2", { email: "  " });
    const r = await S.sendBatch(["j1", "j2"], "biz-1", "jo", V2);
    expect(sent.length).toBe(2);
    expect(emails).toEqual([]);
    for (const t of r.texts) { expect(t.status).toBe("sent"); expect(t.email.status).toBe("no_email"); }
  });
  test("email throw does not stop the text or batch", async () => {
    addJob("j1", { email: "one@example.com" }); addJob("j2", { email: "two@example.com" });
    guarded = new Error("email service down");
    const r = await S.sendBatch(["j1", "j2"], "biz-1", "jo", V2);
    expect(events("area_batch_sent").length).toBe(2);
    expect(sent.length).toBe(2);
    for (const t of r.texts) { expect(t.status).toBe("sent"); expect(t.email).toEqual({ status: "failed", detail: "email service down" }); }
  });
  test("a text throw does not stop the email", async () => {
    addJob("j1", { email: "one@example.com" });
    mock.module("../src/lib/sms.server", () => ({ sendRealSms: async () => { throw new Error("sms down"); } }));
    try {
      const r = await S.sendBatch(["j1"], "biz-1", "jo", V2);
      expect(r.texts[0]).toMatchObject({ status: "failed", detail: "sms down", email: { status: "sent" } });
      expect(emails.length).toBe(1);
    } finally {
      mock.module("../src/lib/sms.server", () => ({
        sendRealSms: async (i: { type: string; to: string; body: string; idempotencyKey: string }) => { sent.push({ via: "real-sms", to: i.to, body: i.body, key: i.idempotencyKey, type: i.type }); return { status: "sent", detail: "ok", sid: "SM1" }; },
      }));
    }
  });
  test("opted-out owner gets no email", async () => {
    addJob("j1", { email: "one@example.com" });
    guarded = "blocked — unsubscribed";
    const r = await S.sendBatch(["j1"], "biz-1", "jo", V2);
    expect(r.texts[0]!.status).toBe("sent");
    expect(r.texts[0]!.email.status).toBe("unsubscribed");
    expect(guardedOpts).toEqual([{ explainBlock: true }]);
  });
  test("final review 1: no consent → no email, text result unchanged, batch still sent", async () => {
    addJob("j1", { email: "one@example.com", consent: false });
    const r = await S.sendBatch(["j1"], "biz-1", "jo", V2);
    expect(emails).toEqual([]);
    expect(guardedOpts).toEqual([]);
    expect(events("area_batch_sent").length).toBe(1);
    expect(sent.length).toBe(1);
    expect(r.texts[0]!.status).toBe("sent");
    expect(r.texts[0]!.email.status).toBe("held");
    expect(r.texts[0]!.email.detail).toContain("No contact consent from the owner on record");
  });
  test("final review 2: each guarded sender answer gets its own status", async () => {
    const cases: [string, string][] = [
      ["blocked — unsubscribed", "unsubscribed"], ["blocked — could not check opt-outs", "blocked"], ["blocked — TEST browser run: no delivery", "blocked"],
      ["delivery uncertain — not retried", "uncertain"], ["already attempted — not resent", "already"], ["failed: send error", "failed"], ["sent", "sent"],
    ];
    for (const [answer, status] of cases) {
      seed(); addJob("j1", { email: "one@example.com" }); guarded = answer;
      const r = await S.sendBatch(["j1"], "biz-1", "jo", V2);
      expect([answer, r.texts[0]!.email.status]).toEqual([answer, status]);
      expect(r.texts[0]!.email.detail).toBe(answer);
    }
  });
  test("already attempted → already", async () => {
    addJob("j1", { email: "one@example.com" });
    guarded = "already attempted — not resent";
    const r = await S.sendBatch(["j1"], "biz-1", "jo", V2);
    expect(r.texts[0]!.email.status).toBe("already");
  });
  test("TEST home → sendTestEmail only", async () => {
    addJob("t1", { source: "qa_test", email: "owner@test.example" });
    installers = [installer({ id: "biz-t", name: "[TEST PARTNER] Co", onboarding_notes: "[TEST PARTNER]" })];
    const r = await S.sendBatch(["t1"], "biz-t", "jo", V2);
    expect(emails).toEqual([]);
    expect(testEmails.map((e) => [e.to, e.subject])).toEqual([["owner@test.example", "It's your turn — confirm your free Ready Check"]]);
    expect(testEmails[0]!.text).toContain("/my-job/T-t1?screen=taps");
    expect(r.texts[0]!.email.status).toBe("sent");
  });
  test("an owner carrying a pass is neither texted nor emailed", async () => {
    addJob("d", { email: "d@example.com" });
    const old = (t: string, details: Row) => tables["workflow_events"]!.push({ job_id: "d", event_type: t, created_at: daysAgo(5), details });
    old("area_batch_sent", { batch_id: "b0", job_ids: ["d"] });
    old("area_batch_left", { batch_id: "b0", reason: "address_moved" });
    old("quick_taps_answered", { batch_id: "b0", outcome: "pass" });
    const r = await S.sendBatch(["d"], "biz-1", "jo", V2);
    expect(emails).toEqual([]); expect(sent).toEqual([]);
    expect(r.texts[0]!.email.status).toBe("not_emailed");
  });
});

describe("Choose installer result words", () => {
  test("plain words for each text and email result", async () => {
    const { sendResultWords } = await import("../src/lib/area-batch.core");
    expect(sendResultWords("text", { status: "sent", detail: "ok" })).toBe("sent");
    expect(sendResultWords("text", { status: "blocked", detail: "quiet hours" })).toBe("didn't go — quiet hours");
    expect(sendResultWords("email", { status: "sent", detail: "sent" })).toBe("sent");
    expect(sendResultWords("email", { status: "no_email", detail: "" })).toBe("no email on file");
    expect(sendResultWords("email", { status: "failed", detail: "email service down" })).toBe("didn't go — email service down");
    expect(sendResultWords("email", { status: "already", detail: "already attempted — not resent" })).toBe("already sent");
  });
  test("final review 2: each email reason in its own words", async () => {
    const { sendResultWords } = await import("../src/lib/area-batch.core");
    expect(sendResultWords("email", { status: "unsubscribed", detail: "blocked — unsubscribed" })).toBe("not sent — unsubscribed");
    expect(sendResultWords("email", { status: "held", detail: "No contact consent from the owner on record – nothing was sent to the customer. (Quick taps email)" })).toBe("not sent — no permission to contact");
    expect(sendResultWords("email", { status: "held", detail: "PRE-LAUNCH: customer communications are disabled – nothing was sent to the customer or trade. (Quick taps email)" })).toBe("not sent — blocked: PRE-LAUNCH: customer communications are disabled – nothing was sent to the customer or trade. (Quick taps email)");
    expect(sendResultWords("email", { status: "blocked", detail: "blocked — could not check opt-outs" })).toBe("not sent — blocked: could not check opt-outs");
    expect(sendResultWords("email", { status: "blocked", detail: "blocked — test recipient boundary" })).toBe("not sent — blocked: test recipient boundary");
    expect(sendResultWords("email", { status: "blocked", detail: "blocked — TEST browser run: no delivery" })).toBe("not sent — blocked: TEST browser run: no delivery");
    expect(sendResultWords("email", { status: "uncertain", detail: "delivery uncertain — not retried" })).toBe("may have gone — not resent");
  });
  test("no Send line says a text only", () => {
    // Saved spots by area (3 Nov 2026): the Suggested batches box (which carried the two "text and an email" lines) is gone.
    const src = readFileSync("src/components/portal/choose-installer.tsx", "utf8");
    expect(src).not.toMatch(/each owner gets a text to/);
  });
});

// ---- Task 6 (Jo 2 Nov 2026): To release — tick up to 10 saved spots and Send ---------------------------------------------
describe("To release tick-to-Send", () => {
  beforeEach(seed);
  test("3 ticked → each owner texted once; a repeat Send of the same homes is refused", async () => {
    for (const id of ids(3)) addJob(id);
    await S.sendBatch(ids(3), "biz-1", "jo", { now: NOW, v2Approved: true });
    expect(sent.length).toBe(3);
    expect(new Set(sent.map((x) => x.key)).size).toBe(3);
    expect(events("area_batch_sent").length).toBe(3);
    await expect(S.sendBatch(ids(3), "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/already in a batch/);
    expect(sent.length).toBe(3);
    expect(events("area_batch_sent").length).toBe(3);
  });
  test("11 homes → refused, nothing recorded or sent", async () => {
    for (const id of ids(11)) addJob(id);
    await expect(S.sendBatch(ids(11), "biz-1", "jo", { now: NOW, v2Approved: true })).rejects.toThrow(/at most 10/);
    expect(events().length).toBe(0); expect(sent.length).toBe(0);
  });
  test("installersForHomes: only installers covering every ticked home, names in normal case", async () => {
    addJob("j1", { postcode: "3000" }); addJob("j2", { postcode: "3001" });
    installers = [
      installer({ id: "biz-1", name: "RAPID INSULATION PTY LTD" }),
      installer({ id: "biz-2", name: "Only 3000", service_postcodes: ["3000"] }),
      installer({ id: "biz-3", name: "INSolation", service_postcodes: ["3000", "3001"] }),
    ];
    expect(await S.installersForHomes(["j1", "j2"])).toEqual([{ id: "biz-1", name: "Rapid Insulation PTY LTD" }, { id: "biz-3", name: "INSolation" }]);
    expect((await S.installersForHomes(["j1"])).map((i) => i.id)).toEqual(["biz-1", "biz-2", "biz-3"]);
  });
  test("installersForHomes: a TEST home only gets TEST partners; a missing job refuses", async () => {
    addJob("t1", { source: "qa_test" });
    installers = [installer(), installer({ id: "biz-t", name: "[TEST PARTNER] Co", onboarding_notes: "[TEST PARTNER]" })];
    expect((await S.installersForHomes(["t1"])).map((i) => i.id)).toEqual(["biz-t"]);
    await expect(S.installersForHomes(["t1", "gone"])).rejects.toThrow(/couldn't be read/);
  });
  test("getInstallersForHomesFn mirrors sendAreaBatchFn's checks (office job per id, TEST office scoped to TEST businesses)", () => {
    const src = readFileSync("src/lib/area-batch.functions.ts", "utf8");
    const fn = src.slice(src.indexOf("export const getInstallersForHomesFn"));
    expect(fn).toMatch(/^export const getInstallersForHomesFn = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)\s*\.inputValidator\(/);
    expect(fn).toContain("z.array(z.string().uuid()).min(1).max(10)");
    expect(fn).toContain("for (const id of data.jobIds) await requireOfficeJob(context.supabase, id, context);");
    expect(fn).toContain("officeTestBusinessIds(context.supabase, context)");
  });
});

// ---- one-off re-ask (Jo 3 Nov 2026, Mia HV-1405 tapped "flat roof" by mistake) ----------------------------------
describe("reaskQuickTaps", () => {
  beforeEach(() => { seed(); reopens.length = 0; });
  const Q = () => import("../src/lib/quick-taps.server");
  async function miaAfterFlat() {
    addJob("m", { email: "m@example.com" });
    (tables["jobs"]![0]!["owners"] as Row)["full_name"] = "Mia Sample";
    await S.sendBatch(["m"], "biz-1", "jo", { now: NOW, v2Approved: true });
    const b1 = String((events("area_batch_sent")[0]!["details"] as Row)["batch_id"]);
    // What the old code saved when she tapped "Flat", then closed the job.
    tables["workflow_events"]!.push({ id: "ans-1", job_id: "m", event_type: "quick_taps_answered", created_at: new Date(clock += 1000).toISOString(),
      details: { batch_id: b1, answers: { roof: "flat", hatch: "yes" }, outcome: "decline_access", consent_share: false, idempotency_key: `quick-taps:v1:${b1}:m:answered` } });
    tables["jobs"]![0]!["stage"] = "cancelled";
    // The live cancel revokes her link (reason job_cancelled); reopening brings it back.
    tables["customer_estimate_links"] = [{ job_id: "m", purpose: "step3_estimate", status: "revoked", revocation_reason: "job_cancelled", expires_at: "2027-11-01T00:00:00Z", token: "T-m" }];
    sent.length = 0; emails.length = 0;
    return b1;
  }
  test("dry run changes nothing", async () => {
    const b1 = await miaAfterFlat(); const before = events().length;
    const r = await (await Q()).reaskQuickTaps("m", { apply: false, actorId: "jo", now: NOW });
    expect(r).toMatchObject({ oldBatchId: b1, answered: "decline_access", installerId: "biz-1", reopened: true, newBatchId: null });
    expect(events().length).toBe(before); expect(reopens).toEqual([]); expect(sent).toEqual([]);
  });
  test("apply: reopened, fresh batch for the same installer, Jo's text only (no email), link asks again", async () => {
    const b1 = await miaAfterFlat();
    const Qs = await Q();
    const r = await Qs.reaskQuickTaps("m", { apply: true, actorId: "jo", now: NOW });
    expect(reopens).toEqual(["m"]);
    expect(r.newBatchId).toBeTruthy(); expect(r.newBatchId).not.toBe(b1);
    expect(events("quick_taps_answered")).toHaveLength(1); // old answer kept, unchanged
    expect(events("area_batch_left").map((e) => (e["details"] as Row)["batch_id"])).toEqual([b1]);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toStartWith("Hi Mia, it's Home Insulation Victoria. Sorry, we think you may have tapped \"flat roof\" by mistake.");
    expect(sent[0]!.body).toContain("my-job/T-m");
    expect(emails).toEqual([]);
    const { tapsBatchId, batchRowState } = await import("../src/lib/area-batch.core");
    const evs = events().filter((e) => e["job_id"] === "m") as never[];
    expect(tapsBatchId(evs)).toBe(r.newBatchId);
    expect(batchRowState(evs)).toMatchObject({ kind: "waiting" });
  });
  test("a second run finds nothing to re-ask and sends nothing", async () => {
    await miaAfterFlat();
    const Qs = await Q();
    await Qs.reaskQuickTaps("m", { apply: true, actorId: "jo", now: NOW });
    sent.length = 0;
    await expect(Qs.reaskQuickTaps("m", { apply: true, actorId: "jo", now: NOW })).rejects.toThrow("nothing to re-ask");
    expect(sent).toEqual([]); expect(reopens).toEqual(["m"]);
  });
  test("I1: still works after the old batch's day-3 close (uses her latest answer, not the open batch)", async () => {
    const b1 = await miaAfterFlat();
    tables["workflow_events"]!.push({ id: "close-1", job_id: "m", event_type: "area_batch_closed", created_at: new Date(clock += 1000).toISOString(),
      details: { batch_id: b1, pass_job_ids: [], freed_job_ids: [], result: "none", idempotency_key: `area-batch-closed:${b1}:m` } });
    const r = await (await Q()).reaskQuickTaps("m", { apply: true, actorId: "jo", now: NOW });
    expect(r.oldBatchId).toBe(b1); expect(r.newBatchId).toBeTruthy(); expect(sent).toHaveLength(1);
  });
  test("I2: refuses an owner whose latest answer isn't a Flat-roof decline (said yes, or No to the hatch)", async () => {
    const Qs = await Q();
    for (const [outcome, answers] of [["pass", { roof: "sloped", hatch: "yes" }], ["decline_access", { hatch: "no" }]] as const) {
      seed(); reopens.length = 0;
      await miaAfterFlat();
      const ans = tables["workflow_events"]!.find((e) => e["id"] === "ans-1")!;
      ans["details"] = { ...(ans["details"] as Row), outcome, answers };
      await expect(Qs.reaskQuickTaps("m", { apply: true, actorId: "jo", now: NOW })).rejects.toThrow("only for an owner who tapped Flat");
      expect(reopens).toEqual([]); expect(sent).toEqual([]);
    }
  });
  test("I3: in quiet hours nothing is changed (no reopen) and it says to try after 7am", async () => {
    await miaAfterFlat();
    const night = new Date("2026-10-30T10:30:00.000Z"); // 9:30pm Melbourne
    await expect((await Q()).reaskQuickTaps("m", { apply: true, actorId: "jo", now: night })).rejects.toThrow("quiet hours");
    expect(reopens).toEqual([]); expect(events("area_batch_left")).toEqual([]); expect(sent).toEqual([]);
  });
  test("I4: the re-ask batch is marked, and its day-2 reminder sends no email", async () => {
    await miaAfterFlat();
    const r = await (await Q()).reaskQuickTaps("m", { apply: true, actorId: "jo", now: NOW });
    const ev = events("area_batch_sent").find((e) => (e["details"] as Row)["batch_id"] === r.newBatchId)!;
    expect((ev["details"] as Row)["reask"]).toBe(true);
    sent.length = 0; emails.length = 0;
    tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { quick_taps: true, quick_taps_reminder: true } }];
    await S.sweepAreaBatches(new Date(clock + 49 * 3_600_000).toISOString());
    expect(sent.length).toBe(1);
    expect(emails).toEqual([]);
  });
  test("a cancelled job whose link was revoked by the cancel is OK (reopen brings it back); an expired one is refused", async () => {
    await miaAfterFlat();
    const Qs = await Q();
    expect((await Qs.reaskQuickTaps("m", { apply: false, actorId: "jo", now: NOW })).reopened).toBe(true);
    tables["customer_estimate_links"]![0]!["expires_at"] = "2026-01-01T00:00:00Z";
    await expect(Qs.reaskQuickTaps("m", { apply: true, actorId: "jo", now: NOW })).rejects.toThrow("no working My job link");
    expect(reopens).toEqual([]);
  });
});
