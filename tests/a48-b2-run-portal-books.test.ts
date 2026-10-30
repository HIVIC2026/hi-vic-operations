// A48 batch 2, Task 7: "Portal books". The installer picks a day (≥ 2 days ahead) and a start time (default 8:00); each home
// in route order gets a 1-hour arrival window (max 8 a day, extras on a second day; a second run the same day starts after
// the first run's last window). Each owner gets the exact approved time text (TEST → test-send, quiet hours respected),
// confirms within 24 h (one reminder at 12 h) — confirm books through bookAgreedTime → confirmBooking("ready_check") once;
// "can't make it" → another free window that day; none suit / no confirm → back in the pool with the standing pass.
// Also the parked Task 6 fix: the installer's 24 h count from the first run text that actually went. In-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { planRunDays, runTimeReminderText, runTimeText, windowWords } from "../src/lib/run-portal.core";

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
        gt(c: string, v: string) { preds.push((r) => String(get(r, c)) > v); return b; },
        lt(c: string, v: string) { preds.push((r) => String(get(r, c)) < v); return b; },
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
            const row = { id: crypto.randomUUID(), created_at: new Date(++clock).toISOString(), active: true, ...payload! }; rows.push(row); out = { data: one ? row : [row], error: null };
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
const sent: { via: string; to: string; body: string; key?: string; type?: string; jobId?: string | null; label?: string }[] = [];
let smsStatus = "sent";
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (i: { type: string; to: string; body: string; idempotencyKey: string; jobId?: string | null }) => {
    if (smsStatus !== "sent" && i.type === "run_offered") return { status: smsStatus, detail: "held: test", sid: null };
    if (sent.some((s) => s.key === i.idempotencyKey)) return { status: "already", detail: "already", sid: null };
    sent.push({ via: "real-sms", to: i.to, body: i.body, key: i.idempotencyKey, type: i.type, jobId: i.jobId ?? null }); return { status: "sent", detail: "ok", sid: "SM1" };
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
mock.module("../src/lib/installer-waiting.server", () => ({ installerFacts: async (ids?: string[]) => [fact("biz-1"), fact("biz-t")].filter((f) => !ids || ids.includes(String(f["id"]))) }));
mock.module("../src/lib/property-coordinates.server", () => ({ ensurePropertyCoordinates: async () => null }));
const LINK = (j: string) => `https://estimate.homeinsulationvictoria.com.au/my-job/tok-${j}`;
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async (jobId: string) => LINK(jobId) }));
// The existing Ready Check booking path (bookAgreedTime → confirmBooking + its follow-ons), recorded.
const booked: { jobId: string; kind: string; start: string; actor: string; role: string }[] = [];
let bookingRefusal: string | null = null;
mock.module("../src/lib/booking.server", () => ({
  confirmBooking: async (jobId: string, kind: string, start: string, actor: string, role: string) => {
    if (bookingRefusal) throw new Error(bookingRefusal);
    booked.push({ jobId, kind, start, actor, role });
  },
}));
const followOns: string[] = [];
mock.module("../src/lib/mitti-create.server", () => ({ onReadyCheckBooked: async (j: string) => { followOns.push(`mitti:${j}`); } }));
mock.module("../src/lib/ready-check-booked-email.server", () => ({ emailOwnerReadyCheckBooked: async (j: string) => { followOns.push(`owner-email:${j}`); } }));
mock.module("../src/lib/installer-texts.server", () => ({ textInstallerReadyCheckBooked: async (j: string) => { followOns.push(`installer-text:${j}`); } }));

const R = await import("../src/lib/installer-run.server");
const A = await import("../src/lib/area-batch.server");

// ---- fixtures ---------------------------------------------------------------------------------------------------
const H = 3_600_000;
const T0 = Date.parse("2026-10-24T01:00:00.000Z"); // Saturday 24 Oct, 12pm Melbourne
const at = (hours: number) => new Date(T0 + hours * H).toISOString();
const now = (hours: number) => { clock = T0 + hours * H; return new Date(clock); };
const GOOD = { declared: { property_type: "house", over_five_years: "yes" }, answers: { insulation: "none" } };
const COORDS: Record<string, [number, number]> = { a: [145.10, -37.80], b: [145.12, -37.81], c: [145.20, -37.82], d: [145.13, -37.80] };
function addJob(id: string, o: { source?: string } = {}) {
  tables["jobs"]!.push({
    id, job_number: `HV-${id}`, stage: "ready_check_ready_to_schedule", source: o.source ?? "website", channel: "hivic_sourced",
    deleted_at: null, qa_archived_at: null, property_id: `p-${id}`, created_at: "2026-10-01T00:00:00Z", estimated_area_m2: 95, estimated_area_unknown: false,
    owners: { full_name: `Owner ${id.toUpperCase()}`, phone: `04000000${String(id.charCodeAt(0)).padStart(2, "0")}` },
    properties: { address_line: `${id.length} Sample Street`, suburb: "Box Hill", postcode: "3128", ...GOOD },
  });
  tables["lead_campaign_responses"]!.push({ job_id: id, spot_saved_at: "2026-10-01T00:00:00Z", opted_out_at: null, saved_insulation: null });
  tables["property_facts"]!.push({ property_id: `p-${id}`, job_id: id, fact_key: "coordinates", value: COORDS[id] ?? [145.1 + id.charCodeAt(0) / 1000, -37.8], is_current: true });
}
const ev = (jobId: string, type: string, hours: number, details: Row) => tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: jobId, event_type: type, created_at: at(hours), details });
const ANSWERS = { name: "x", address: "y", hatch: "yes", roof: "some", five_years: "not_sure", go: "yes" };
function closedBatch(batchId: string, jobIds: string[], installer = "biz-1") {
  for (const j of jobIds) ev(j, "area_batch_sent", -80, { batch_id: batchId, installer_business_id: installer, installer_name: "Sample Insulation", job_ids: jobIds, idempotency_key: `area-batch:v1:${j}:1` });
  for (const j of jobIds) ev(j, "quick_taps_answered", -70, { batch_id: batchId, answers: ANSWERS, consent_share: true, outcome: "pass" });
  for (const j of jobIds) ev(j, "area_batch_closed", -8, { batch_id: batchId, pass_job_ids: jobIds, freed_job_ids: [], result: "pass", idempotency_key: `area-batch-closed:v1:${batchId}:${j}` });
}
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  sent.length = 0; booked.length = 0; followOns.length = 0; smsStatus = "sent"; bookingRefusal = null;
  tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { run_offered: true } }];
  for (const t of ["jobs", "lead_campaign_responses", "property_facts", "job_assignments", "partner_offers", "workflow_events", "appointment_proposals"]) tables[t] = [];
  tables["businesses"] = [
    { id: "biz-1", name: "Sample Insulation", business_type: "eec_installer", signer_name: "Sam Smith", signer_mobile: "0411111111", phone: null, onboarding_notes: null, is_active: true },
    { id: "biz-t", name: "[TEST PARTNER] Co", business_type: "eec_installer", signer_name: null, signer_mobile: "0433333333", phone: null, onboarding_notes: "[TEST PARTNER]", is_active: true },
  ];
  tables["business_members"] = [
    { user_id: "u-sam", business_id: "biz-1", member_role: "business_admin", active: true },
    { user_id: "u-tess", business_id: "biz-t", member_role: "business_admin", active: true },
  ];
  tables["user_roles"] = [{ user_id: "u-sam", role: "installer" }, { user_id: "u-tess", role: "installer" }];
  tables["profiles"] = [{ id: "u-sam", full_name: "Sam Smith" }, { id: "u-tess", full_name: "Tess Test" }];
}
const events = (type?: string, jobId?: string) => (tables["workflow_events"] ?? []).filter((e) => (!type || e["event_type"] === type) && (!jobId || e["job_id"] === jobId));
const candidates = async () => (await A.batchCandidates({ includeTest: true, locate: 0 })).candidates;
const ownerTexts = (type = "run_time") => sent.filter((s) => s.type === type);
/** A run offered (text sent) at hour 1 for these homes; returns the run id and its route order. */
async function offered(ids: string[], o: { batch?: string; installer?: string; source?: string } = {}) {
  for (const id of ids) addJob(id, { source: o.source });
  closedBatch(o.batch ?? "b1", ids, o.installer);
  now(1);
  const r = await R.offerRun(o.batch ?? "b1", "u-jo", { now: new Date(clock) });
  const order = (events("run_offered").find((e) => (e["details"] as Row)["run_id"] === r.runId)!["details"] as { job_ids: string[] }).job_ids;
  sent.length = 0;
  return { runId: r.runId, order };
}
const DAY = "2026-10-27"; // Tuesday, 3 days ahead
const slotOf = (jobId: string) => events("run_slot_proposed", jobId).map((e) => e["details"] as Row).sort((x, y) => Number(y["seq"]) - Number(x["seq"]))[0];

// ---- pure ----------------------------------------------------------------------------------------------------------------
describe("pure: wording + plan", () => {
  test("window words: one am/pm when both match, else both", () => {
    expect(windowWords("09:00", "10:00")).toBe("between 9:00 and 10:00am");
    expect(windowWords("12:00", "13:00")).toBe("between 12:00 and 1:00pm");
    expect(windowWords("11:00", "12:00")).toBe("between 11:00am and 12:00pm");
    expect(windowWords("08:30", "09:30")).toBe("between 8:30 and 9:30am");
  });
  test("exact approved owner wording (time text + 12-hour reminder)", () => {
    expect(runTimeText({ name: "Ann Lee", day: "Tuesday 27 October", time: "between 9:00 and 10:00am", installer: "Sample Insulation", link: "L" }))
      .toBe("Hi Ann, your free Ready Check is Tuesday 27 October at between 9:00 and 10:00am with Sample Insulation. Tap to confirm or pick another time: L - Home Insulation Victoria");
    expect(runTimeReminderText({ name: "Ann Lee", day: "Tuesday 27 October", time: "between 9:00 and 10:00am", link: "L" }))
      .toBe("Hi Ann, please confirm your free Ready Check on Tuesday 27 October at between 9:00 and 10:00am: L");
  });
  test("plan: > 8 homes needs a second day", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `j${i}`);
    expect(planRunDays({ memberIds: ids, day: DAY, start: "08:00", held: [] })).toEqual({ ok: false, why: "2 more homes need a second day. Please pick a second day." });
    const p = planRunDays({ memberIds: ids, day: DAY, start: "08:00", secondDay: "2026-10-28", held: [] });
    if (!p.ok) throw new Error(p.why);
    expect(p.slots.filter((s) => s.day === DAY).map((s) => s.start)).toEqual(["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
    expect(p.slots.filter((s) => s.day === "2026-10-28").map((s) => [s.jobId, s.start, s.end])).toEqual([["j8", "08:00", "09:00"], ["j9", "09:00", "10:00"]]);
  });
});

describe("SMS types", () => {
  test("run_time + run_time_reminder: owner audience, approved wording, quiet hours, own switches (off: not in the switches)", () => {
    expect(SMS_MESSAGE_TYPES.run_time).toMatchObject({ audience: "owner", wordingApproved: true, quietHours: true });
    expect(SMS_MESSAGE_TYPES.run_time_reminder).toMatchObject({ audience: "owner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.run_time).toEqual({ kind: "window" });
    expect(SMS_FRESHNESS.run_time_reminder).toEqual({ kind: "window" });
  });
});

// ---- the installer picks the day ---------------------------------------------------------------------------------------------
describe("chooseRunDay (Portal books)", () => {
  beforeEach(seed);
  test("a day less than 2 days ahead is refused; nothing written or sent", async () => {
    const { runId } = await offered(["a", "b"]);
    now(2);
    await expect(R.chooseRunDay(runId, "u-sam", "2026-10-25", "08:00", null, { now: new Date(clock) })).rejects.toThrow(/at least 2 days/);
    await expect(R.chooseRunDay(runId, "u-sam", "2026-10-24", "08:00", null, { now: new Date(clock) })).rejects.toThrow(/at least 2 days/);
    expect(events("run_mode_chosen")).toEqual([]);
    expect(events("run_slot_proposed")).toEqual([]);
    expect(sent).toEqual([]);
    await R.chooseRunDay(runId, "u-sam", "2026-10-26", "08:00", null, { now: new Date(clock) });
    expect(events("run_slot_proposed").length).toBe(2);
  });
  test("windows in route order from the start time; each owner gets the exact approved text with their window", async () => {
    const { runId, order } = await offered(["a", "b", "c", "d"]);
    now(2);
    const r = await R.chooseRunDay(runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    expect(r.slots.map((s) => [s.jobId, s.start, s.end])).toEqual([[order[0], "09:00", "10:00"], [order[1], "10:00", "11:00"], [order[2], "11:00", "12:00"], [order[3], "12:00", "13:00"]]);
    expect(events("run_mode_chosen").map((e) => (e["details"] as Row)["mode"])).toEqual(["portal", "portal", "portal", "portal"]);
    const t = ownerTexts();
    expect(t.length).toBe(4);
    expect(t.find((x) => x.jobId === order[0])).toMatchObject({ key: `run-time-sms:v1:${runId}:${order[0]}:1`,
      body: `Hi Owner, your free Ready Check is Tuesday 27 October at between 9:00 and 10:00am with Sample Insulation. Tap to confirm or pick another time: ${LINK(order[0]!)} - Home Insulation Victoria` });
    expect(t.find((x) => x.jobId === order[3])!.body).toContain("Tuesday 27 October at between 12:00 and 1:00pm with Sample Insulation");
    expect(events("run_time_texted").length).toBe(4);
    // the installer page shows each window; the run no longer expires (answered)
    const page = await R.tradeRun(runId, "u-sam");
    expect(page.status).toBe("answered");
    expect(page.homes.map((h) => h.slot?.window)).toEqual(["9:00", "10:00", "11:00", "12:00"].map((s, i) => `Tuesday 27 October, ${windowWords(["09:00", "10:00", "11:00", "12:00"][i]!, ["10:00", "11:00", "12:00", "13:00"][i]!)}`));
    await R.sweepRunOffers(at(30));
    expect(events("run_expired")).toEqual([]);
    // a second choice is refused
    await expect(R.chooseRunDay(runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) })).rejects.toThrow(/no longer open/);
    expect(ownerTexts().length).toBe(4);
  });
  test("default start 8:00; another business can't choose", async () => {
    const { runId } = await offered(["a"]);
    now(2);
    await expect(R.chooseRunDay(runId, "u-other", DAY, undefined, null, { now: new Date(clock) })).rejects.toThrow();
    const r = await R.chooseRunDay(runId, "u-sam", DAY, undefined, null, { now: new Date(clock) });
    expect(r.slots.map((s) => s.start)).toEqual(["08:00"]);
  });
  test("> 8 homes needs a second day (refused without one; extras on the second day with one)", async () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const { runId, order } = await offered(ids);
    now(2);
    await expect(R.chooseRunDay(runId, "u-sam", DAY, "08:00", null, { now: new Date(clock) })).rejects.toThrow(/1 more home needs a second day/);
    expect(events("run_slot_proposed")).toEqual([]);
    await expect(R.chooseRunDay(runId, "u-sam", DAY, "08:00", "2026-10-25", { now: new Date(clock) })).rejects.toThrow(/at least 2 days/);
    const r = await R.chooseRunDay(runId, "u-sam", DAY, "08:00", "2026-10-28", { now: new Date(clock) });
    expect(r.slots.filter((s) => s.day === DAY).length).toBe(8);
    expect(r.slots.filter((s) => s.day === "2026-10-28").map((s) => [s.jobId, s.start])).toEqual([[order[8], "08:00"]]);
    expect(ownerTexts().find((x) => x.jobId === order[8])!.body).toContain("Wednesday 28 October at between 8:00 and 9:00am");
  });
  test("same day twice: a second run for the same installer that day starts after the first run's last window", async () => {
    const r1 = await offered(["a", "b", "c"], { batch: "b1" });
    const r2 = await offered(["d", "e"], { batch: "b2" });
    now(2);
    await R.chooseRunDay(r1.runId, "u-sam", DAY, "08:00", null, { now: new Date(clock) });
    const second = await R.chooseRunDay(r2.runId, "u-sam", DAY, "08:00", null, { now: new Date(clock) });
    expect(second.slots.map((s) => [s.start, s.end])).toEqual([["11:00", "12:00"], ["12:00", "13:00"]]);
    // never overlapping, never more than 8 that day
    const all = events("run_slot_proposed").map((e) => (e["details"] as Row)["start"]);
    expect(new Set(all).size).toBe(all.length);
  });
  test("TEST run → owner texts go through test-send only", async () => {
    const { runId } = await offered(["a"], { batch: "bt", installer: "biz-t", source: "qa_test" });
    now(2);
    await R.chooseRunDay(runId, "u-tess", DAY, "08:00", null, { now: new Date(clock) });
    expect(sent.map((x) => [x.via, x.label?.startsWith("run_time:")])).toEqual([["test-sms", true]]);
    expect(sent[0]!.body).toContain("your free Ready Check is Tuesday 27 October at between 8:00 and 9:00am with Co.");
  });
});

// ---- the owner ---------------------------------------------------------------------------------------------------------------
describe("owner: confirm / can't make it / none suit", () => {
  beforeEach(seed);
  async function chosen(ids = ["a", "b", "c"]) {
    const r = await offered(ids);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    sent.length = 0;
    return r;
  }
  test("confirm → bookAgreedTime → confirmBooking(job, \"ready_check\", window start) ONCE; the installer is assigned", async () => {
    const { runId, order } = await chosen();
    const j = order[0]!;
    now(3);
    const st = await R.ownerRunSlotState(j, { now: new Date(clock) });
    expect(st).toMatchObject({ kind: "proposed", day: "Tuesday 27 October", time: "between 9:00 and 10:00am", installer: "Sample Insulation" });
    await R.ownerConfirmRunSlot(j, "u-owner", { now: new Date(clock) });
    await R.ownerConfirmRunSlot(j, "u-owner", { now: new Date(clock) });
    expect(booked).toEqual([{ jobId: j, kind: "ready_check", start: "2026-10-26T22:00:00.000Z", actor: "u-owner", role: "owner (run window)" }]);
    expect(followOns).toEqual([`mitti:${j}`, `owner-email:${j}`, `installer-text:${j}`]);
    expect(tables["job_assignments"]!.filter((a) => a["job_id"] === j && a["active"] === true).map((a) => [a["business_id"], a["user_id"], a["role"]])).toEqual([["biz-1", "u-sam", "installer"]]);
    expect(events("run_slot_confirmed", j).length).toBe(1);
    expect((await R.ownerRunSlotState(j, { now: new Date(clock) })).kind).toBe("confirmed");
    // confirmed windows are never released by the sweep
    await R.sweepRunSlots(at(40));
    expect(events("run_slot_released", j)).toEqual([]);
    expect(runId).toBeTruthy();
  });
  test("booking refused → the window waits again, the new assignment is ended, the owner sees the reason", async () => {
    const { order } = await chosen();
    const j = order[0]!;
    bookingRefusal = "The Ready Check must be assigned to an approved installer.";
    now(3);
    await expect(R.ownerConfirmRunSlot(j, "u-owner", { now: new Date(clock) })).rejects.toThrow(/approved installer/);
    expect(tables["job_assignments"]!.filter((a) => a["job_id"] === j && a["active"] === true)).toEqual([]);
    expect((await R.ownerRunSlotState(j, { now: new Date(clock) })).kind).toBe("proposed");
    bookingRefusal = null;
    await R.ownerConfirmRunSlot(j, "u-owner", { now: new Date(clock) });
    expect(booked.length).toBe(1);
  });
  test("can't make it → another free window that day (taken ones not offered) → booked there", async () => {
    const { order } = await chosen();
    const [a, b] = [order[0]!, order[1]!];
    now(3);
    const st = await R.ownerRunSlotState(a, { now: new Date(clock) });
    expect(st.kind === "proposed" && st.free.map((w) => w.start)).toEqual(["12:00", "13:00", "14:00", "15:00", "16:00"]);
    await R.ownerPickRunWindow(a, "u-owner", "13:00", { now: new Date(clock) });
    expect(booked).toEqual([{ jobId: a, kind: "ready_check", start: "2026-10-27T02:00:00.000Z", actor: "u-owner", role: "owner (run window)" }]);
    // b can't take 13:00 any more; a's old 09:00 is free again
    const sb = await R.ownerRunSlotState(b, { now: new Date(clock) });
    expect(sb.kind === "proposed" && sb.free.map((w) => w.start)).toEqual(["09:00", "12:00", "14:00", "15:00", "16:00"]);
    await expect(R.ownerPickRunWindow(b, "u-owner", "13:00", { now: new Date(clock) })).rejects.toThrow(/just been taken/);
    expect(booked.length).toBe(1);
  });
  test("none suit → released: back in the pool with the standing pass (not asked again); nothing booked, nothing sent", async () => {
    const { runId, order } = await chosen();
    const a = order[0]!;
    now(3);
    await R.ownerNoRunWindow(a, "u-owner", { now: new Date(clock) });
    await R.ownerNoRunWindow(a, "u-owner", { now: new Date(clock) });
    expect(events("run_slot_released", a).map((e) => (e["details"] as Row)["why"])).toEqual(["none_suit"]);
    expect((await candidates()).map((x) => [x.jobId, x.carriedPass])).toEqual([[a, true]]);
    expect(booked).toEqual([]);
    expect(sent).toEqual([]);
    await expect(R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) })).rejects.toThrow();
    expect((await R.tradeRun(runId, "u-sam")).homes.map((h) => h.jobId)).not.toContain(a);
    // its window is free for the others
    const sb = await R.ownerRunSlotState(order[1]!, { now: new Date(clock) });
    expect(sb.kind === "proposed" && sb.free.map((w) => w.start)[0]).toBe("09:00");
  });
});

// ---- the tick: 12-hour reminder, 24-hour release, quiet hours, closed jobs --------------------------------------------------
describe("sweepRunSlots", () => {
  beforeEach(seed);
  test("12 h reminder once (held overnight until 7am), then released 24 h after the text; back in the pool", async () => {
    const { runId, order } = await offered(["a", "b"]);
    now(2); // 2pm: texts go now
    await R.chooseRunDay(runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    sent.length = 0;
    await R.ownerConfirmRunSlot(order[1]!, "u-owner", { now: new Date(clock) });
    now(13.9); await R.sweepRunSlots(at(13.9));
    expect(ownerTexts("run_time_reminder")).toEqual([]);
    now(14.1); await R.sweepRunSlots(at(14.1)); // 2:06am — quiet hours
    expect(ownerTexts("run_time_reminder")).toEqual([]);
    now(19.1); await R.sweepRunSlots(at(19.1)); // 7:06am
    expect(ownerTexts("run_time_reminder").map((x) => [x.jobId, x.body])).toEqual([[order[0], `Hi Owner, please confirm your free Ready Check on Tuesday 27 October at between 9:00 and 10:00am: ${LINK(order[0]!)}`]]);
    now(20); await R.sweepRunSlots(at(20));
    expect(ownerTexts("run_time_reminder").length).toBe(1);
    now(25.9); await R.sweepRunSlots(at(25.9));
    expect(events("run_slot_released")).toEqual([]);
    now(26.1); await R.sweepRunSlots(at(26.1));
    expect(events("run_slot_released").map((e) => [e["job_id"], (e["details"] as Row)["why"]])).toEqual([[order[0], "no_confirm"]]);
    await R.sweepRunSlots(at(27));
    expect(events("run_slot_released").length).toBe(1);
    expect((await candidates()).map((x) => [x.jobId, x.carriedPass])).toEqual([[order[0], true]]);
    expect(ownerTexts("run_time")).toEqual([]);
  });
  test("chosen during quiet hours → texts wait for 7am; a job cancelled meanwhile is never texted; the 24 h count from the text", async () => {
    const { runId, order } = await offered(["a", "b"]);
    now(10); // 10pm
    await R.chooseRunDay(runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    expect(ownerTexts()).toEqual([]);
    tables["jobs"]!.find((j) => j["id"] === order[1])!["stage"] = "cancelled";
    now(19.1); await R.sweepRunSlots(at(19.1));
    expect(ownerTexts().map((x) => x.jobId)).toEqual([order[0]]);
    now(34); await R.sweepRunSlots(at(34)); // texted 7:06am → due 7:06am the next day (hour 43.1)
    expect(events("run_slot_released", order[0]!)).toEqual([]);
    now(43.2); await R.sweepRunSlots(at(43.2));
    expect(events("run_slot_released", order[0]!).length).toBe(1);
    expect(sent.filter((x) => x.jobId === order[1])).toEqual([]);
  });
});

// ---- parked from Task 6 ------------------------------------------------------------------------------------------------------
describe("installer's 24 h count from the first run text that went", () => {
  beforeEach(seed);
  test("held first text → no expiry; re-texted at hour 10 → expires 24 h after that", async () => {
    for (const id of ["a", "b"]) addJob(id);
    closedBatch("b1", ["a", "b"]);
    now(1); smsStatus = "blocked";
    const r1 = await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    now(30); await R.sweepRunOffers(at(30));
    expect(events("run_expired")).toEqual([]);
    smsStatus = "sent";
    now(31); await R.offerRun("b1", "u-jo", { now: new Date(clock) });
    now(54.9); await R.sweepRunOffers(at(54.9));
    expect(events("run_expired")).toEqual([]);
    now(55.1); await R.sweepRunOffers(at(55.1));
    expect(events("run_expired").map((e) => (e["details"] as Row)["run_id"])).toEqual([r1.runId, r1.runId]);
  });
});

// ---- wiring --------------------------------------------------------------------------------------------------------------
describe("wiring", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  test("the confirmed window books through the existing bookAgreedTime path", () => {
    expect(src("src/lib/installer-run.server.ts")).toContain("bookAgreedTime(");
    expect(src("src/lib/ready-check-times.server.ts")).toMatch(/export async function bookAgreedTime/);
  });
  test("owner + installer screens, functions and the tick", () => {
    expect(src("src/routes/api/public/hooks/allocation-tick.ts")).toContain("sweepRunSlots");
    const page = src("src/routes/_authenticated/field.run.$runId.tsx");
    expect(page).toContain("Portal books");
    expect(page).toContain("chooseTradeRunDay");
    const owner = src("src/lib/owner-link.functions.ts");
    for (const f of ["ownerRunSlotFn", "ownerConfirmRunSlotFn", "ownerPickRunWindowFn", "ownerNoRunWindowFn"]) expect(owner).toContain(`export const ${f} = createServerFn`);
    expect(src("src/routes/my-job.$token.tsx")).toContain("<OwnerRunTime token={token} />");
    const hub = src("src/lib/template-hub.core.ts");
    expect(hub).toContain('smsType: "run_time"');
    expect(hub).toContain('smsType: "run_time_reminder"');
  });
});
