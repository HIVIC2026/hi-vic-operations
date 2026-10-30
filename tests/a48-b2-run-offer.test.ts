// A48 batch 2, Task 6: the installer's run — route order + arrival windows (pure), Jo's one tap "Send to installer"
// (offerRun: the exact approved installer text, once), the installer's run page (address, owner name + phone where the
// owner agreed to share, m² with its source, the quick-tap answers incl. roof shape), removing homes (back to the pool,
// owner not told), `empty run` (every home removed → the run ends, nothing to owners), decline / 24 h no reply → the
// passers are batch candidates again with their standing pass (owners not asked again). In-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { orderRun, windowsFor, runOfferedText } from "../src/lib/run-route.core";
import { passHandedOn } from "../src/lib/area-batch.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const subset = (a: unknown, b: unknown): boolean => {
  if (b && typeof b === "object" && !Array.isArray(b)) return !!a && typeof a === "object" && Object.entries(b as Row).every(([k, v]) => subset((a as Row)[k], v));
  return a === b;
};
let clock = Date.parse("2026-10-20T00:00:00.000Z");
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
          if (op === "insert") {
            const rows = (tables[table] ??= []);
            const row = { id: crypto.randomUUID(), created_at: new Date(++clock).toISOString(), ...payload! }; rows.push(row); out = { data: one ? row : [row], error: null };
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

// ---- recorded fakes ----------------------------------------------------------------------------------------------
const sent: { via: string; to: string; body: string; key?: string; type?: string; businessId?: string | null; label?: string }[] = [];
let smsStatus = "sent"; // what the real sender answers ("blocked" = held after the run was claimed, e.g. STOP / consent)
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (i: { type: string; to: string; body: string; idempotencyKey: string; businessId?: string | null }) => {
    if (smsStatus !== "sent") return { status: smsStatus, detail: "held: test", sid: null };
    if (sent.some((s) => s.key === i.idempotencyKey)) return { status: "already", detail: "already", sid: null };
    sent.push({ via: "real-sms", to: i.to, body: i.body, key: i.idempotencyKey, type: i.type, businessId: i.businessId ?? null }); return { status: "sent", detail: "ok", sid: "SM1" };
  },
}));
const TEST_BASE = "https://id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app";
mock.module("../src/lib/test-send.server", () => ({
  TEST_APP_BASE: TEST_BASE,
  sendTestEmail: async () => { throw new Error("no email here"); },
  sendTestSms: async (c: { label: string }, to: string, body: string) => { sent.push({ via: "test-sms", to, body, label: c.label }); return { status: "sent", detail: "ok" }; },
}));
const fact = (id: string, o: Row = {}) => ({
  id, name: id, is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true, coverage_verified_at: "2026-10-01T00:00:00Z",
  service_postcodes: ["3128"], free_measureups_for_hivic_quote_leads: true, onboarding_notes: id === "biz-t" ? "[TEST PARTNER]" : null, credentialsOk: true, fullCertifiedInstallers: 1, covers_all_victoria: false, ...o,
});
let installerFacts: Row[] = [];
mock.module("../src/lib/installer-waiting.server", () => ({ installerFacts: async (ids?: string[]) => installerFacts.filter((f) => !ids || ids.includes(String(f["id"]))) }));
mock.module("../src/lib/property-coordinates.server", () => ({ ensurePropertyCoordinates: async () => null }));

const R = await import("../src/lib/installer-run.server");
const A = await import("../src/lib/area-batch.server");

// ---- fixtures ---------------------------------------------------------------------------------------------------
const H = 3_600_000;
const T0 = Date.parse("2026-10-24T01:00:00.000Z"); // 12pm Melbourne
const at = (hours: number) => new Date(T0 + hours * H).toISOString();
const now = (hours: number) => { clock = T0 + hours * H; return new Date(clock); };
const GOOD = { declared: { property_type: "house", over_five_years: "yes" }, answers: { insulation: "none" } };
const PLACES: Record<string, [string, string, [number, number]]> = {
  a: ["1 Alpha Street", "Box Hill", [145.10, -37.80]],
  b: ["2 Beta Road", "Box Hill", [145.12, -37.81]],
  c: ["3 Gamma Avenue", "Blackburn", [145.20, -37.82]],
  d: ["4 Delta Court", "Mitcham", [145.13, -37.80]],
};
function addJob(id: string, o: { source?: string; stage?: string; area?: number | null } = {}) {
  const [street, suburb, coords] = PLACES[id] ?? ["9 Sample Street", "Melbourne", [145, -37.8]];
  tables["jobs"]!.push({
    id, job_number: `HV-${id}`, stage: o.stage ?? "ready_check_ready_to_schedule", source: o.source ?? "website", channel: "hivic_sourced",
    deleted_at: null, qa_archived_at: null, property_id: `p-${id}`, created_at: "2026-10-01T00:00:00Z", estimated_area_m2: o.area === undefined ? 95 : o.area, estimated_area_unknown: false,
    owners: { full_name: `Owner ${id.toUpperCase()}`, phone: `040000000${id.charCodeAt(0) % 10}` },
    properties: { address_line: street, suburb, postcode: "3128", ...GOOD },
  });
  tables["lead_campaign_responses"]!.push({ job_id: id, spot_saved_at: "2026-10-01T00:00:00Z", opted_out_at: null, saved_insulation: null });
  tables["property_facts"]!.push({ property_id: `p-${id}`, job_id: id, fact_key: "coordinates", value: coords, is_current: true });
}
const ev = (jobId: string, type: string, hours: number, details: Row) => tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: jobId, event_type: type, created_at: at(hours), details });
const ANSWERS = { name: "x", address: "y", hatch: "yes", roof: "some", five_years: "not_sure", go: "yes" };
/** A batch sent to `installer`, every owner passed (consent to share), closed on day 3. */
function closedBatch(batchId: string, jobIds: string[], installer = "biz-1", o: { noShare?: string[] } = {}) {
  for (const j of jobIds) ev(j, "area_batch_sent", -80, { batch_id: batchId, installer_business_id: installer, installer_name: "Sample Insulation", job_ids: jobIds, idempotency_key: `area-batch:v1:${j}:1` });
  for (const j of jobIds) ev(j, "quick_taps_answered", -70, { batch_id: batchId, answers: ANSWERS, consent_share: !o.noShare?.includes(j), outcome: "pass" });
  for (const j of jobIds) ev(j, "area_batch_closed", -8, { batch_id: batchId, pass_job_ids: jobIds, freed_job_ids: [], result: "pass", idempotency_key: `area-batch-closed:v1:${batchId}:${j}` });
}
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  sent.length = 0; smsStatus = "sent";
  installerFacts = [fact("biz-1"), fact("biz-2"), fact("biz-t")];
  tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { run_offered: true } }];
  for (const t of ["jobs", "lead_campaign_responses", "property_facts", "job_assignments", "partner_offers", "workflow_events"]) tables[t] = [];
  tables["businesses"] = [
    { id: "biz-1", name: "Sample Insulation", business_type: "eec_installer", signer_name: "Sam Smith", signer_mobile: "0411111111", phone: null, onboarding_notes: null, is_active: true },
    { id: "biz-2", name: "Other Insulation", business_type: "eec_installer", signer_name: "Olive Other", signer_mobile: "0422222222", phone: null, onboarding_notes: null, is_active: true },
    { id: "biz-t", name: "[TEST PARTNER] Co", business_type: "eec_installer", signer_name: null, signer_mobile: "0433333333", phone: null, onboarding_notes: "[TEST PARTNER]", is_active: true },
  ];
  tables["business_members"] = [
    { user_id: "u-sam", business_id: "biz-1", member_role: "business_admin", active: true },
    { user_id: "u-olive", business_id: "biz-2", member_role: "business_admin", active: true },
  ];
  tables["user_roles"] = [{ user_id: "u-sam", role: "installer" }, { user_id: "u-olive", role: "installer" }];
  tables["profiles"] = [{ id: "u-sam", full_name: "Sam Smith" }, { id: "u-olive", full_name: "Olive Other" }];
}
const events = (type?: string, jobId?: string) => (tables["workflow_events"] ?? []).filter((e) => (!type || e["event_type"] === type) && (!jobId || e["job_id"] === jobId));
const candidates = async () => (await A.batchCandidates({ includeTest: true, locate: 0 })).candidates;
const ownerTexts = () => sent.filter((s) => s.type !== "run_offered" && !String(s.label ?? "").startsWith("run_offered"));

// ---- pure: route order + windows ---------------------------------------------------------------------------------
describe("orderRun / windowsFor", () => {
  test("orderRun: start at the home furthest from the centre, then nearest each time — same order whatever the input order", () => {
    const pts = [
      { jobId: "a", lat: -37.8, lng: 145.00 },
      { jobId: "b", lat: -37.8, lng: 145.01 },
      { jobId: "c", lat: -37.8, lng: 145.02 },
      { jobId: "d", lat: -37.8, lng: 145.05 },
    ];
    expect(orderRun(pts)).toEqual(["d", "c", "b", "a"]);
    expect(orderRun([...pts].reverse())).toEqual(["d", "c", "b", "a"]);
    expect(orderRun([pts[2]!, pts[0]!, pts[3]!, pts[1]!])).toEqual(["d", "c", "b", "a"]);
  });
  test("orderRun: ties go to the lower job id; homes with no location go last", () => {
    const tie = [{ jobId: "y", lat: -37.8, lng: 145.01 }, { jobId: "x", lat: -37.8, lng: 144.99 }, { jobId: "m", lat: -37.8, lng: 145.0 }, { jobId: "z", lat: Number.NaN, lng: Number.NaN }];
    expect(orderRun(tie)).toEqual(["x", "m", "y", "z"]);
  });
  test('windowsFor("08:00", 10) → 8 one-hour windows 08:00–16:00, 2 overflow', () => {
    const w = windowsFor("08:00", 10);
    expect(w.windows).toEqual([
      { start: "08:00", end: "09:00" }, { start: "09:00", end: "10:00" }, { start: "10:00", end: "11:00" }, { start: "11:00", end: "12:00" },
      { start: "12:00", end: "13:00" }, { start: "13:00", end: "14:00" }, { start: "14:00", end: "15:00" }, { start: "15:00", end: "16:00" },
    ]);
    expect(w.overflow).toBe(2);
    expect(windowsFor("08:30", 3)).toEqual({ windows: [{ start: "08:30", end: "09:30" }, { start: "09:30", end: "10:30" }, { start: "10:30", end: "11:30" }], overflow: 0 });
    expect(() => windowsFor("8am", 2)).toThrow();
  });
});

// ---- the text type ---------------------------------------------------------------------------------------------------
describe("run_offered text type", () => {
  test("partner audience, approved wording, quiet hours, one-off (24h), its own switch (off unless switched on)", () => {
    expect(SMS_MESSAGE_TYPES.run_offered).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.run_offered).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
  });
  test("exact approved wording", () => {
    expect(runOfferedText({ name: "Sam Smith", homes: 8, suburb: "Box Hill", link: "https://x/field/run/1" }))
      .toBe("Hi Sam, you've got a run of 8 Ready Checks around Box Hill. Pick your day: https://x/field/run/1 - Home Insulation Victoria");
    expect(runOfferedText({ name: null, homes: 1, suburb: "Box Hill", link: "L" })).toBe("Hi there, you've got a run of 1 Ready Checks around Box Hill. Pick your day: L - Home Insulation Victoria");
  });
});

// ---- Jo's tap: offerRun -----------------------------------------------------------------------------------------------
describe("offerRun (Jo taps Send to installer)", () => {
  beforeEach(seed);
  test("sends the exact installer text ONCE to the installer Jo picked at Send; one run_offered per home in route order", async () => {
    for (const id of ["a", "b", "c", "d"]) addJob(id);
    closedBatch("b1", ["a", "b", "c", "d"]);
    now(1);
    const r = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    expect(r.homes).toBe(4);
    const link = `https://estimate.homeinsulationvictoria.com.au/field/run/${r.runId}`;
    expect(sent).toEqual([{ via: "real-sms", to: "0411111111", type: "run_offered", businessId: "biz-1", key: `run-offered-sms:v1:${r.runId}:1`,
      body: `Hi Sam, you've got a run of 4 Ready Checks around Box Hill. Pick your day: ${link} - Home Insulation Victoria` }]);
    const offered = events("run_offered");
    expect(offered.map((e) => e["job_id"]).sort()).toEqual(["a", "b", "c", "d"]);
    const d0 = offered[0]!["details"] as Row;
    expect(d0).toMatchObject({ run_id: r.runId, batch_id: "b1", business_id: "biz-1", expires_at: at(25) });
    expect([...(d0["job_ids"] as string[])].sort()).toEqual(["a", "b", "c", "d"]);
    expect(d0["job_ids"]).toEqual(orderRun(["a", "b", "c", "d"].map((j) => ({ jobId: j, lat: PLACES[j]![2][1], lng: PLACES[j]![2][0] }))));
    // a second tap: refused, nothing more sent or written
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/already/);
    expect(sent.length).toBe(1);
    expect(events("run_offered").length).toBe(4);
  });
  test("the batch leaves Ready to send once offered; its homes stay out of new batches while offered", async () => {
    for (const id of ["a", "b"]) addJob(id);
    closedBatch("b1", ["a", "b"]);
    expect((await A.batchesReadyToSend({ now: now(0) })).map((b) => b.batchId)).toEqual(["b1"]);
    now(1); await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    expect(await A.batchesReadyToSend({ now: now(2) })).toEqual([]);
    expect(await candidates()).toEqual([]);
  });
  test("homes no longer waiting (cancelled meanwhile) are left out and never contacted", async () => {
    for (const id of ["a", "b"]) addJob(id);
    closedBatch("b1", ["a", "b"]);
    tables["jobs"]!.find((j) => j["id"] === "b")!["stage"] = "cancelled";
    now(1);
    const r = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    expect(r.homes).toBe(1);
    expect(events("run_offered").map((e) => e["job_id"])).toEqual(["a"]);
    expect(sent[0]!.body).toContain("a run of 1 Ready Checks");
  });
  test("TEST batch → test-send (TEST app link), never the real sender", async () => {
    addJob("a", { source: "qa_test" });
    closedBatch("bt", ["a"], "biz-t");
    now(1);
    const r = await R.offerRun("bt", "u-jo", { now: new Date(clock) });
    expect(sent).toEqual([{ via: "test-sms", to: "0433333333", label: `run_offered:${r.runId}`, body: `Hi there, you've got a run of 1 Ready Checks around Box Hill. Pick your day: ${TEST_BASE}/field/run/${r.runId} - Home Insulation Victoria` }]);
  });
  test("refused when the batch has no waiting passers, or isn't a closed batch", async () => {
    addJob("a");
    closedBatch("b1", ["a"]);
    tables["jobs"]![0]!["stage"] = "cancelled";
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/nothing was sent/);
    await expect(R.offerRun("nope", "u-jo", { now: new Date(clock) })).rejects.toThrow(/nothing was sent/);
    expect(sent).toEqual([]);
    expect(events("run_offered")).toEqual([]);
  });
});

// ---- fix round 1 -------------------------------------------------------------------------------------------------------
describe("fix round 1: refuse when the text would be held; resend a run whose text never went; coverage at tap time", () => {
  beforeEach(seed);
  const ready = () => { for (const id of ["a", "b"]) addJob(id); closedBatch("b1", ["a", "b"]); now(1); };
  const ws = () => tables["workflow_settings"]![0]!;
  for (const [what, set] of [
    ["the run_offered switch is off", () => { ws()["sms_message_switches"] = { run_offered: false }; }],
    ["customer messages are off", () => { ws()["customer_comms_enabled"] = false; }],
    ["trade messages are paused", () => { ws()["trade_messages_paused"] = true; }],
  ] as const) {
    test(`real run refused when ${what}: no run_offered, no text`, async () => {
      ready(); set();
      await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/nothing was sent\.?$/i);
      expect(events("run_offered")).toEqual([]);
      expect(sent).toEqual([]);
    });
  }
  test("no trade_messages_paused column (separate PR not merged) = not paused", async () => {
    ready();
    expect("trade_messages_paused" in ws()).toBe(false);
    await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    expect(sent.length).toBe(1);
  });
  test("TEST runs skip the real-text checks (test-send only)", async () => {
    addJob("a", { source: "qa_test" }); closedBatch("bt", ["a"], "biz-t"); now(1);
    ws()["sms_message_switches"] = {};
    await R.offerRun("bt", "u-jo", { now: new Date(clock) });
    expect(sent.map((x) => x.via)).toEqual(["test-sms"]);
  });
  test("text held after the claim → the next tap re-texts the SAME run (no new claims); once it went → refused", async () => {
    ready();
    smsStatus = "blocked";
    const r1 = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    expect(r1.text.status).toBe("blocked");
    expect(sent).toEqual([]);
    expect(events("run_offered").length).toBe(2);
    smsStatus = "sent"; now(2);
    const r2 = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    expect(r2.runId).toBe(r1.runId);
    expect(r2.text.status).toBe("sent");
    expect(sent.map((x) => [x.key, x.body.includes(`/field/run/${r1.runId}`)])).toEqual([[`run-offered-sms:v1:${r1.runId}:2`, true]]);
    expect(events("run_offered").length).toBe(2);
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/already been sent/);
    expect(sent.length).toBe(1);
  });
  test("a declined run is never re-texted by the tap", async () => {
    ready();
    smsStatus = "failed";
    const r1 = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    await R.declineRun(r1.runId, "u-sam");
    smsStatus = "sent";
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/already been sent/);
    expect(sent).toEqual([]);
  });
  test("installer can't be offered every home any more (e.g. not taking jobs / area) → refused, nothing written", async () => {
    ready();
    installerFacts = [fact("biz-1", { accepting_new_jobs: false })];
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/can't be offered every home.*nothing was sent/);
    installerFacts = [fact("biz-1", { service_postcodes: ["3000"] })];
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/can't be offered every home/);
    installerFacts = [];
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/can't be offered every home/);
    expect(events("run_offered")).toEqual([]);
    expect(sent).toEqual([]);
  });
  test("passHandedOn: another job's release in the same batch doesn't free this job", () => {
    const evs = [
      { job_id: "x", event_type: "area_batch_closed", created_at: at(0), details: { batch_id: "b1", pass_job_ids: ["x", "y"] } },
      { job_id: "y", event_type: "run_home_removed", created_at: at(1), details: { batch_id: "b1", run_id: "r1" } },
    ];
    expect(passHandedOn(evs, "x")).toBe(true);
    expect(passHandedOn(evs, "y")).toBe(false);
    // per-job lists (rows without job_id) still work
    expect(passHandedOn(evs.map(({ job_id: _j, ...e }) => e), "x")).toBe(false);
  });
});

// ---- the installer's run page -----------------------------------------------------------------------------------------
describe("run page", () => {
  beforeEach(seed);
  async function offered(o: { noShare?: string[] } = {}) {
    for (const id of ["a", "b", "c"]) addJob(id);
    tables["jobs"]!.find((j) => j["id"] === "b")!["estimated_area_m2"] = null;
    tables["property_facts"]!.push({ property_id: "p-a", job_id: "a", fact_key: "preliminary_ceiling_area", value: { net_m2: 110.4, tier: "E" }, is_current: true });
    tables["property_facts"]!.push({ property_id: "p-b", job_id: "b", fact_key: "preliminary_ceiling_area", value: { net_m2: 120, tier: "E" }, is_current: true });
    closedBatch("b1", ["a", "b", "c"], "biz-1", o);
    now(1);
    return R.offerRun("b1", "u-jo", { now: new Date(clock) });
  }
  test("each home: address, owner name + phone, m² with its source (best first), quick-tap answers incl. roof shape — route order", async () => {
    const { runId } = await offered();
    const page = await R.tradeRun(runId, "u-sam");
    expect(page.status).toBe("offered");
    expect(page.homes.map((h) => h.jobId)).toEqual((events("run_offered")[0]!["details"] as { job_ids: string[] }).job_ids);
    const a = page.homes.find((h) => h.jobId === "a")!;
    expect(a).toMatchObject({ address: "1 Alpha Street, Box Hill VIC 3128", ownerName: "Owner A", phone: "0400000007" });
    expect(a.area).toEqual(["110 m² · aerial roof outline, approx.", "95 m² · owner's estimate"]);
    expect(a.taps).toEqual([
      ["Is there a manhole or hatch into your roof space?", "Yes"],
      ["Is your roof sloped, flat, or some of each?", "Some of each"],
      ["Was your home built, or its ceiling replaced, in the last 5 years?", "Not sure"],
    ]);
    expect(page.homes.find((h) => h.jobId === "b")!.area).toEqual(["120 m² · aerial roof outline, approx."]);
    expect(page.homes.find((h) => h.jobId === "c")!.area).toEqual(["95 m² · owner's estimate"]);
  });
  test("owner contact only where the owner agreed to share", async () => {
    const { runId } = await offered({ noShare: ["c"] });
    const c = (await R.tradeRun(runId, "u-sam")).homes.find((h) => h.jobId === "c")!;
    expect(c.ownerName).toBeNull();
    expect(c.phone).toBeNull();
  });
  test("only the installer's own business sees the run", async () => {
    const { runId } = await offered();
    await expect(R.tradeRun(runId, "u-olive")).rejects.toThrow(/isn't for your business/);
    await expect(R.tradeRun(crypto.randomUUID(), "u-sam")).rejects.toThrow(/isn't for your business/);
    await expect(R.removeRunHome(runId, "a", "u-olive")).rejects.toThrow(/isn't for your business/);
    await expect(R.declineRun(runId, "u-olive")).rejects.toThrow(/isn't for your business/);
    expect(events("run_home_removed")).toEqual([]);
    expect(events("run_declined")).toEqual([]);
  });
});

// ---- remove / empty run / decline / expiry -----------------------------------------------------------------------------
describe("remove, empty run, decline, 24 h expiry", () => {
  beforeEach(seed);
  async function offered() {
    for (const id of ["a", "b", "c"]) addJob(id);
    closedBatch("b1", ["a", "b", "c"]);
    now(1);
    const r = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    sent.length = 0;
    return r.runId;
  }
  test("remove a home → back in the pool (a candidate again, carried pass — not asked again); owner not told", async () => {
    const runId = await offered();
    now(2); await R.removeRunHome(runId, "b", "u-sam");
    expect(events("run_home_removed").map((e) => [e["job_id"], (e["details"] as Row)["run_id"]])).toEqual([["b", runId]]);
    const c = await candidates();
    expect(c.map((x) => [x.jobId, x.carriedPass])).toEqual([["b", true]]);
    expect(sent).toEqual([]);
    const page = await R.tradeRun(runId, "u-sam");
    expect(page.homes.map((h) => h.jobId).sort()).toEqual(["a", "c"]);
    // twice → one event
    await R.removeRunHome(runId, "b", "u-sam");
    expect(events("run_home_removed").length).toBe(1);
  });
  test("empty run: every home removed → the run ends, nothing sent to any owner, no expiry later", async () => {
    const runId = await offered();
    for (const j of ["a", "b", "c"]) await R.removeRunHome(runId, j, "u-sam");
    expect((await R.tradeRun(runId, "u-sam")).status).toBe("ended");
    expect(sent).toEqual([]);
    expect((await candidates()).map((x) => x.jobId).sort()).toEqual(["a", "b", "c"]);
    await R.sweepRunOffers(at(30));
    expect(events("run_expired")).toEqual([]);
    expect(sent).toEqual([]);
  });
  test("decline → every home back in Jo's suggestions with its standing pass; owners not asked again; no expiry later", async () => {
    const runId = await offered();
    now(2); await R.removeRunHome(runId, "a", "u-sam");
    now(3); await R.declineRun(runId, "u-sam");
    expect(events("run_declined").map((e) => e["job_id"]).sort()).toEqual(["b", "c"]);
    expect((await candidates()).map((x) => [x.jobId, x.carriedPass]).sort()).toEqual([["a", true], ["b", true], ["c", true]]);
    expect(ownerTexts()).toEqual([]);
    expect(sent).toEqual([]);
    expect((await R.tradeRun(runId, "u-sam")).status).toBe("declined");
    await expect(R.declineRun(runId, "u-sam")).rejects.toThrow(/no longer open/);
    await expect(R.removeRunHome(runId, "b", "u-sam")).rejects.toThrow(/no longer open/);
    await R.sweepRunOffers(at(30));
    expect(events("run_expired")).toEqual([]);
  });
  test("24 h with no reply → expired: homes back in suggestions, once; nothing sent; not before 24 h", async () => {
    const runId = await offered();
    await R.sweepRunOffers(at(24.5));
    expect(events("run_expired")).toEqual([]);
    expect((await candidates())).toEqual([]);
    now(25.5); await R.sweepRunOffers(at(25.5));
    expect(events("run_expired").map((e) => [e["job_id"], (e["details"] as Row)["run_id"]]).sort()).toEqual([["a", runId], ["b", runId], ["c", runId]]);
    await R.sweepRunOffers(at(26));
    expect(events("run_expired").length).toBe(3);
    expect((await candidates()).map((x) => [x.jobId, x.carriedPass]).sort()).toEqual([["a", true], ["b", true], ["c", true]]);
    expect(sent).toEqual([]);
    expect((await R.tradeRun(runId, "u-sam")).status).toBe("expired");
  });
  test("a run the installer answered (Task 7 run_mode_chosen) never expires", async () => {
    const runId = await offered();
    ev("a", "run_mode_chosen", 5, { run_id: runId, mode: "portal" });
    await R.sweepRunOffers(at(30));
    expect(events("run_expired")).toEqual([]);
  });
  test("a released home re-batched and passed again is handed on again (not a candidate)", async () => {
    const runId = await offered();
    now(2); await R.declineRun(runId, "u-sam");
    // Jo puts b in a new batch (carried pass) which closes with b passed
    ev("b", "area_batch_sent", 10, { batch_id: "b2", installer_business_id: "biz-2", job_ids: ["b"], carried_pass: true });
    ev("b", "area_batch_closed", 90, { batch_id: "b2", pass_job_ids: ["b"], freed_job_ids: [] });
    expect((await candidates()).map((x) => x.jobId).sort()).toEqual(["a", "c"]);
    expect((await A.batchesReadyToSend({ now: now(91) })).map((b) => [b.batchId, b.installer.id])).toEqual([["b2", "biz-2"]]);
  });
});

// ---- final review fixes (I1, I2) -----------------------------------------------------------------------------------------
describe("final review I1: a run whose installer text never went", () => {
  beforeEach(seed);
  const ready = () => { for (const id of ["a", "b"]) addJob(id); closedBatch("b1", ["a", "b"]); now(1); };
  test("stays listed as \"Text didn't go — Send again\"; the tap re-texts the same run; then it leaves the list", async () => {
    ready();
    smsStatus = "blocked";
    const r1 = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    const listed = await A.batchesReadyToSend({ now: now(2) });
    expect(listed.map((b) => [b.batchId, b.state, b.runId, b.installer.id, b.homes.map((h) => h.jobId).sort()])).toEqual([["b1", "text_not_sent", r1.runId, "biz-1", ["a", "b"]]]);
    smsStatus = "sent";
    const r2 = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    expect(r2.runId).toBe(r1.runId);
    expect(sent.length).toBe(1);
    expect(await A.batchesReadyToSend({ now: now(3) })).toEqual([]);
  });
  test("no text went → the sweep expires the run 24 h after the offer: owners back in the pool with their standing pass", async () => {
    ready();
    smsStatus = "blocked";
    const r1 = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    await R.sweepRunOffers(at(24.9));
    expect(events("run_expired")).toEqual([]);
    // past 24 h but before the sweep: Send again is refused (the run is about to expire), and the batch isn't listed
    now(25.05);
    expect(await A.batchesReadyToSend({ now: new Date(clock) })).toEqual([]);
    smsStatus = "sent";
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/nothing was sent/);
    expect(sent).toEqual([]);
    await R.sweepRunOffers(at(25.1));
    expect(events("run_expired").map((e) => [e["job_id"], (e["details"] as Row)["run_id"]]).sort()).toEqual([["a", r1.runId], ["b", r1.runId]]);
    expect((await candidates()).map((x) => [x.jobId, x.carriedPass]).sort()).toEqual([["a", true], ["b", true]]);
    expect(await A.batchesReadyToSend({ now: now(26) })).toEqual([]);
    expect(sent).toEqual([]);
  });
});

describe("final review I2: passers never stuck", () => {
  beforeEach(seed);
  const ready = () => { for (const id of ["a", "b"]) addJob(id); closedBatch("b1", ["a", "b"]); now(1); };
  test("Ready to send lists every installer that covers every home, the batch's original first (the default)", async () => {
    ready();
    const [b] = await A.batchesReadyToSend({ now: new Date(clock) });
    expect(b!.state).toBe("ready");
    expect(b!.installer.id).toBe("biz-1");
    expect(b!.installers.map((i) => i.id)).toEqual(["biz-1", "biz-2"]);
  });
  test("the original installer can't take the homes → Jo sends to another covering installer; the run and text go to them", async () => {
    ready();
    installerFacts = [fact("biz-1", { service_postcodes: ["3000"] }), fact("biz-2")];
    const [b] = await A.batchesReadyToSend({ now: new Date(clock) });
    expect(b!.installers.map((i) => i.id)).toEqual(["biz-2"]);
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock) })).rejects.toThrow(/can't be offered every home/);
    const r = await R.offerRun("b1", "u-jo", { now: new Date(clock), businessId: "biz-2" });
    expect(r.installer).toBe("Other Insulation");
    expect(sent.map((x) => [x.to, x.businessId])).toEqual([["0422222222", "biz-2"]]);
    expect(events("run_offered").map((e) => (e["details"] as Row)["business_id"])).toEqual(["biz-2", "biz-2"]);
    expect((await R.tradeRun(r.runId, "u-olive")).homes.length).toBe(2);
  });
  test("an installer that doesn't cover every home is refused, nothing written", async () => {
    ready();
    installerFacts = [fact("biz-1"), fact("biz-2", { service_postcodes: ["3000"] })];
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock), businessId: "biz-2" })).rejects.toThrow(/can't be offered every home/);
    expect(events("run_offered")).toEqual([]);
    expect(sent).toEqual([]);
  });
  test("Send again goes to the run's own installer; another installer is refused", async () => {
    ready();
    smsStatus = "blocked";
    await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    smsStatus = "sent";
    await expect(R.offerRun("b1", "u-jo", { now: new Date(clock), businessId: "biz-2" })).rejects.toThrow(/nothing was sent/);
    expect(sent).toEqual([]);
    await R.offerRun("b1", "u-jo", { now: new Date(clock), businessId: "biz-1" });
    expect(sent.map((x) => x.to)).toEqual(["0411111111"]);
  });
  test("Back to suggestions: the passers are batch candidates again with their standing pass; the batch leaves the list; once", async () => {
    ready();
    expect(await candidates()).toEqual([]);
    const r = await R.returnBatchToSuggestions("b1", "u-jo");
    expect(r.homes).toBe(2);
    expect(events("area_batch_returned").map((e) => [e["job_id"], (e["details"] as Row)["batch_id"]]).sort()).toEqual([["a", "b1"], ["b", "b1"]]);
    expect(await A.batchesReadyToSend({ now: now(2) })).toEqual([]);
    expect((await candidates()).map((x) => [x.jobId, x.carriedPass]).sort()).toEqual([["a", true], ["b", true]]);
    await R.returnBatchToSuggestions("b1", "u-jo");
    expect(events("area_batch_returned").length).toBe(2);
    expect(sent).toEqual([]);
  });
  test("Back to suggestions on a run whose text never went ends that run (nothing sent); refused once the text went", async () => {
    ready();
    smsStatus = "blocked";
    const r1 = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    await R.returnBatchToSuggestions("b1", "u-jo");
    expect((await R.tradeRun(r1.runId, "u-sam")).status).toBe("expired");
    expect((await candidates()).map((x) => [x.jobId, x.carriedPass]).sort()).toEqual([["a", true], ["b", true]]);
    expect(await A.batchesReadyToSend({ now: now(2) })).toEqual([]);
    expect(sent).toEqual([]);
    // another batch whose run text went: refused, nothing written
    for (const id of ["c", "d"]) addJob(id);
    closedBatch("b2", ["c", "d"]);
    smsStatus = "sent";
    await R.offerRun("b2", "u-jo", { now: now(3) });
    await expect(R.returnBatchToSuggestions("b2", "u-jo")).rejects.toThrow(/already been sent to the installer/);
    expect(events("area_batch_returned").filter((e) => (e["details"] as Row)["batch_id"] === "b2")).toEqual([]);
  });
  test("no 60-day cut-off: a batch closed long ago with owners still waiting is still listed", async () => {
    ready();
    expect((await A.batchesReadyToSend({ now: now(24 * 120) })).map((b) => b.batchId)).toEqual(["b1"]);
  });
});

// ---- wiring -------------------------------------------------------------------------------------------------------------
describe("wiring", () => {
  test("final review: Send again / Back to suggestions / installer choice are office-only and wired", () => {
    const src = (p: string) => readFileSync(p, "utf8");
    const ui = src("src/components/portal/choose-installer.tsx");
    for (const s of ["Text didn't go — Send again", "Send again", "Back to suggestions", "returnBatchFn"]) expect(ui).toContain(s);
    const fns = src("src/lib/installer-run.functions.ts");
    expect(fns).toMatch(/export const returnBatchFn = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)/);
    expect(fns.slice(fns.indexOf("export const returnBatchFn"))).toMatch(/requireOfficeIdentity[\s\S]*qa_office/);
    expect(fns).toMatch(/businessId: uuid\.nullable\(\)\.optional\(\)/);
    expect(src("src/lib/area-batch.server.ts")).not.toMatch(/READY_DAYS/);
  });
});

describe("wiring (existing)", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  test("Send to installer is wired to the office-only offerRunFn (never from a sweep); TEST office refused", () => {
    const ui = src("src/components/portal/choose-installer.tsx");
    expect(ui).toContain("offerRunFn");
    expect(ui).not.toMatch(/disabled>Send to installer</);
    const fns = src("src/lib/installer-run.functions.ts");
    expect(fns).toMatch(/export const offerRunFn = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[requireSupabaseAuth\]\)/);
    expect(fns).toContain("requireOfficeIdentity");
    expect(fns).toMatch(/qa_office/);
    expect(src("src/lib/area-batch.server.ts")).not.toMatch(/offerRun\(/);
    expect(src("src/routes/api/public/hooks/allocation-tick.ts")).not.toMatch(/offerRun\(/);
  });
  test("24h expiry runs on the 15-minute tick", () => {
    expect(src("src/routes/api/public/hooks/allocation-tick.ts")).toContain("sweepRunOffers");
  });
  test("installer run page route exists under the trade screens", () => {
    const page = src("src/routes/_authenticated/field.run.$runId.tsx");
    expect(page).toContain('createFileRoute("/_authenticated/field/run/$runId")');
    expect(page).toContain("getTradeRun");
    expect(src("src/routeTree.gen.ts")).toContain("/field/run/$runId");
  });
});
