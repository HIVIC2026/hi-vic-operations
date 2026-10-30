// A48 batch 2, Task 8: "Our team books", Move run, and an owner cancelling a confirmed window.
// - Our team books: the installer's team calls the owners and enters each agreed day + exact time (no portal limits: any
//   day, any time, no 8-a-day cap, no window claims); each entered time sends the owner the approved time text (exact time
//   in the existing Ready Check wording "at 9am") and the owner confirms → the existing booking path. Homes not booked
//   within 5 days → back to Jo's suggestions with their standing pass, once, on the tick.
// - Move run: every owner still in the run gets a new window to confirm; a confirmed owner's old booking is released
//   through the existing Ready Check change path (booking cancelled, back to "to schedule"); window claims move with them.
// - Owner cancels (their job) after confirming: the installer is told ONCE (`run_slot_cancelled`, off by default) and gets
//   "Fill from nearby waiting owners" — the nearest owner with a standing pass within 10 km gets that window through the
//   portal window flow. Not tapped → nothing happens. Cancelled/closed jobs are never texted. In-memory fake database.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { exactTimeWords, runSlotCancelledText, runTeamTimeText, windowWords } from "../src/lib/run-portal.core";
import { SET_PASSWORD_BASE } from "../src/lib/set-password-link.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const subset = (a: unknown, b: unknown): boolean => {
  if (b && typeof b === "object" && !Array.isArray(b)) return !!a && typeof a === "object" && Object.entries(b as Row).every(([k, v]) => subset((a as Row)[k], v));
  return a === b;
};
let clock = Date.parse("2026-10-20T00:00:00.000Z");
/** Tables whose updates fail (Task 9: the assignment update in endMovedBooking). */
const failUpdates = new Set<string>();
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
        like(c: string, v: string) { const re = new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`); preds.push((r) => re.test(String(get(r, c) ?? ""))); return b; },
        not() { return b; },
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
          } else if (op === "update" && failUpdates.has(table)) {
            out = { data: null, error: { message: `${table} update failed` } };
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
/** Every call to the real sender (a held call writes an sms_messages row in the real one). */
const realAttempts: { type: string; key: string }[] = [];
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (i: { type: string; to: string; body: string; idempotencyKey: string; jobId?: string | null }) => {
    realAttempts.push({ type: i.type, key: i.idempotencyKey });
    const ws = (tables["workflow_settings"] ?? [])[0] as { customer_comms_enabled?: boolean; sms_message_switches?: Record<string, boolean> } | undefined;
    if (ws?.customer_comms_enabled !== true || ws?.sms_message_switches?.[i.type] !== true) return { status: "held", detail: "switch off", sid: null };
    if (sent.some((s) => s.key === i.idempotencyKey)) return { status: "already", detail: "already", sid: null };
    sent.push({ via: "real-sms", to: i.to, body: i.body, key: i.idempotencyKey, type: i.type, jobId: i.jobId ?? null }); return { status: "sent", detail: "ok", sid: "SM1" };
  },
}));
const TEST_BASE = "https://id-preview--fb35adfe-10bf-4d4c-987d-28567ca1ddeb.lovable.app";
mock.module("../src/lib/test-send.server", () => ({
  TEST_APP_BASE: TEST_BASE,
  sendTestEmail: async () => { throw new Error("no email here"); },
  sendTestSms: async (c: { label: string; jobId?: string }, to: string, body: string) => { sent.push({ via: "test-sms", to, body, label: c.label, jobId: c.jobId ?? null }); return { status: "sent", detail: "ok" }; },
}));
const fact = (id: string, o: Row = {}) => ({
  id, name: id, is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true, coverage_verified_at: "2026-10-01T00:00:00Z",
  service_postcodes: ["3128"], free_measureups_for_hivic_quote_leads: true, onboarding_notes: id === "biz-t" ? "[TEST PARTNER]" : null, credentialsOk: true, fullCertifiedInstallers: 1, covers_all_victoria: false, ...o,
});
mock.module("../src/lib/installer-waiting.server", () => ({ installerFacts: async (ids?: string[]) => [fact("biz-1"), fact("biz-t")].filter((f) => !ids || ids.includes(String(f["id"]))) }));
mock.module("../src/lib/property-coordinates.server", () => ({ ensurePropertyCoordinates: async () => null }));
const LINK = (j: string) => `https://estimate.homeinsulationvictoria.com.au/my-job/tok-${j}`;
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async (jobId: string) => LINK(jobId) }));
// The existing Ready Check booking path (bookAgreedTime → confirmBooking + its follow-ons), recorded; it moves the stage and
// writes the booking like the real one (a reschedule at ready_check_scheduled cancels the old booking first).
const booked: { jobId: string; kind: string; start: string; actor: string; role: string }[] = [];
mock.module("../src/lib/booking.server", () => ({
  confirmBooking: async (jobId: string, kind: string, start: string, actor: string, role: string) => {
    const job = tables["jobs"]!.find((j) => j["id"] === jobId)!;
    if (!["ready_check_ready_to_schedule", "ready_check_scheduled"].includes(String(job["stage"]))) throw new Error("wrong stage");
    for (const bk of tables["bookings"]!) if (bk["job_id"] === jobId && bk["status"] === "confirmed") bk["status"] = "cancelled";
    tables["bookings"]!.push({ id: crypto.randomUUID(), job_id: jobId, kind, status: "confirmed", scheduled_start: start });
    job["stage"] = "ready_check_scheduled";
    booked.push({ jobId, kind, start, actor, role });
  },
}));
const followOns: string[] = [];
mock.module("../src/lib/mitti-create.server", () => ({ onReadyCheckBooked: async (j: string) => { followOns.push(`mitti:${j}`); } }));
mock.module("../src/lib/ready-check-booked-email.server", () => ({ emailOwnerReadyCheckBooked: async (j: string) => { followOns.push(`owner-email:${j}`); } }));
mock.module("../src/lib/installer-texts.server", () => ({
  textInstallerReadyCheckBooked: async (j: string) => { followOns.push(`installer-text:${j}`); },
  textTradeOwnerChangedVisit: async () => { followOns.push("owner-changed-text"); },
}));
// The Mitti form release on a cancelled Ready Check (existing helper), recorded.
const mittiReleased: string[] = [];
const realPickup = await import("../src/lib/mitti-pickup.server");
mock.module("../src/lib/mitti-pickup.server", () => ({ ...realPickup, releaseReadyCheckFormOnCancel: async (j: string) => { mittiReleased.push(j); return { released: true }; } }));
// The office Cancel's stage move (existing applyHoldOrCancel), recorded as the stage only.
mock.module("../src/lib/job-disposition.server", () => ({ applyHoldOrCancel: async (j: string) => { tables["jobs"]!.find((x) => x["id"] === j)!["stage"] = "cancelled"; } }));
// The stage move back to "to schedule" (the existing transition), recorded.
const realWorkflow = await import("../src/lib/workflow.server");
const moved: { jobId: string; to: string }[] = [];
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  transition: async (jobId: string, to: string) => { moved.push({ jobId, to }); tables["jobs"]!.find((j) => j["id"] === jobId)!["stage"] = to; },
  logEvent: async (jobId: string, actor: string | null, type: string, summary: string, details: Row) => { tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: jobId, event_type: type, created_at: new Date(++clock).toISOString(), summary, details, actor_id: actor }); },
}));

const R = await import("../src/lib/installer-run.server");
const A = await import("../src/lib/area-batch.server");

// ---- fixtures ---------------------------------------------------------------------------------------------------
const H = 3_600_000;
const T0 = Date.parse("2026-10-24T01:00:00.000Z"); // Saturday 24 Oct, 12pm Melbourne
const at = (hours: number) => new Date(T0 + hours * H).toISOString();
const now = (hours: number) => { clock = T0 + hours * H; return new Date(clock); };
const GOOD = { declared: { property_type: "house", over_five_years: "yes" }, answers: { insulation: "none" } };
const COORDS: Record<string, [number, number]> = { a: [145.10, -37.80], b: [145.12, -37.81], c: [145.20, -37.82], d: [145.13, -37.80], e: [145.11, -37.80], f: [146.50, -38.20], g: [145.101, -37.80] };
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
/** A waiting owner who passed the quick taps in a batch they then left: a standing pass (not in any run). */
function standingPassOwner(id: string, o: { source?: string } = {}) {
  addJob(id, o);
  ev(id, "area_batch_sent", -90, { batch_id: `b-${id}`, installer_business_id: "biz-1", job_ids: [id], idempotency_key: `area-batch:v1:${id}:1` });
  ev(id, "quick_taps_answered", -89, { batch_id: `b-${id}`, answers: ANSWERS, consent_share: true, outcome: "pass" });
  ev(id, "area_batch_left", -88, { batch_id: `b-${id}`, reason: "address_moved" });
}
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  sent.length = 0; booked.length = 0; followOns.length = 0; moved.length = 0; mittiReleased.length = 0; realAttempts.length = 0; failUpdates.clear();
  tables["workflow_settings"] = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { run_offered: true, run_time: true, run_time_reminder: true, run_slot_cancelled: true } }];
  for (const t of ["jobs", "lead_campaign_responses", "property_facts", "job_assignments", "partner_offers", "workflow_events", "appointment_proposals", "bookings"]) tables[t] = [];
  tables["businesses"] = [
    { id: "biz-1", name: "Sample Insulation", business_type: "eec_installer", signer_name: "Sam Smith", signer_mobile: "0411111111", phone: null, onboarding_notes: null, is_active: true },
    { id: "biz-t", name: "[TEST PARTNER] Co", business_type: "eec_installer", signer_name: null, signer_mobile: "0433333333", phone: null, onboarding_notes: "[TEST PARTNER]", is_active: true },
  ];
  tables["business_members"] = [
    { user_id: "u-sam", business_id: "biz-1", member_role: "business_admin", active: true },
    { user_id: "u-kim", business_id: "biz-1", member_role: "staff", active: true },
    { user_id: "u-tess", business_id: "biz-t", member_role: "business_admin", active: true },
  ];
  // PostgREST embed read by tradeContext (`business_members → businesses(...)`), kept live against the businesses rows.
  for (const m of tables["business_members"]!) Object.defineProperty(m, "businesses", { enumerable: true, configurable: true, get: () => (tables["businesses"] ?? []).find((b) => b["id"] === m["business_id"]) ?? null });
  tables["profiles"] = [{ id: "u-sam", full_name: "Sam Smith" }, { id: "u-kim", full_name: "Kim Lee" }, { id: "u-tess", full_name: "Tess Test" }];
}
const events = (type?: string, jobId?: string) => (tables["workflow_events"] ?? []).filter((e) => (!type || e["event_type"] === type) && (!jobId || e["job_id"] === jobId));
const candidates = async () => (await A.batchCandidates({ includeTest: true, locate: 0 })).candidates;
const ownerTexts = (type = "run_time") => sent.filter((s) => s.type === type);
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
const stage = (jobId: string) => tables["jobs"]!.find((j) => j["id"] === jobId)!["stage"];
const cancelJob = (jobId: string) => { tables["jobs"]!.find((j) => j["id"] === jobId)!["stage"] = "cancelled"; for (const bk of tables["bookings"]!) if (bk["job_id"] === jobId) bk["status"] = "cancelled"; };

// ---- pure + SMS type -------------------------------------------------------------------------------------------------
describe("wording + SMS type", () => {
  test("a team-entered time is an exact time in the existing Ready Check wording (\"at 9am\"), not a window", () => {
    expect(exactTimeWords("2026-10-27", "09:00")).toBe("at 9am");
    expect(exactTimeWords("2026-10-25", "06:15")).toBe("at 6:15am");
    expect(exactTimeWords("2026-10-27", "13:30")).toBe("at 1:30pm");
  });
  test("run_slot_cancelled: INSTALLER text, own switch (off: not in the switches), quiet hours, wording approved by Jo (fix round 1); a held text is retried by the tick", () => {
    expect(SMS_MESSAGE_TYPES.run_slot_cancelled).toMatchObject({ audience: "partner", wordingApproved: true, quietHours: true });
    expect(SMS_FRESHNESS.run_slot_cancelled).toEqual({ kind: "window" });
    expect(runSlotCancelledText({ name: "Sam Smith", day: "Tuesday 27 October", time: windowWords("09:00", "10:00"), link: "L" }))
      .toBe("Hi Sam, an owner cancelled their Ready Check on Tuesday 27 October between 9:00 and 10:00am. To offer that time to a nearby waiting owner: L - Home Insulation Victoria");
  });
  test("team-entered time owner text: Jo's approved wording (fix round 1), no \"pick another time\"", () => {
    expect(runTeamTimeText({ name: "Ann Lee", day: "Sunday 25 October", time: exactTimeWords("2026-10-25", "06:15"), installer: "Sample Insulation", link: "L" }))
      .toBe("Hi Ann, your free Ready Check is Sunday 25 October at 6:15am with Sample Insulation. Tap to confirm: L - Home Insulation Victoria");
  });
});

// ---- Our team books ------------------------------------------------------------------------------------------------------
describe("Our team books", () => {
  beforeEach(seed);
  async function team(ids = ["a", "b", "c"], person = "u-kim") {
    const r = await offered(ids);
    now(2);
    await R.chooseTeamBooks(r.runId, "u-sam", { personId: person, now: new Date(clock) });
    return r;
  }
  test("choosing it: one run_mode_chosen {mode: team} per home with the chosen person; nothing sent; the 24 h expiry stops", async () => {
    const { runId, order } = await team();
    expect(events("run_mode_chosen").map((e) => [e["job_id"], (e["details"] as Row)["mode"], (e["details"] as Row)["person"]])).toEqual(order.map((j) => [j, "team", "u-kim"]));
    expect(events("run_slot_proposed")).toEqual([]);
    expect(sent).toEqual([]);
    await R.sweepRunOffers(at(30));
    expect(events("run_expired")).toEqual([]);
    const page = await R.tradeRun(runId, "u-sam");
    expect(page).toMatchObject({ status: "answered", mode: "team" });
    // portal can't be chosen after; the tick never plans portal windows for a team run
    await expect(R.chooseRunDay(runId, "u-sam", DAY, "08:00", null, { now: new Date(clock) })).rejects.toThrow(/no longer open/);
    await R.sweepRunSlots(at(3));
    expect(events("run_slot_proposed")).toEqual([]);
  });
  test("the person must be active in the business's team; nothing written otherwise", async () => {
    const { runId } = await offered(["a"]);
    now(2);
    await expect(R.chooseTeamBooks(runId, "u-sam", { personId: "u-tess", now: new Date(clock) })).rejects.toThrow(/who's doing these Ready Checks/i);
    expect(events("run_mode_chosen")).toEqual([]);
  });
  test("no portal limits: tomorrow, off the half-hour grid, the same time for every home — each owner gets the confirm text with the exact time", async () => {
    const { runId, order } = await team(["a", "b", "c"]);
    for (const j of order) await R.enterTeamTime(runId, "u-kim", j, "2026-10-25", "06:15", { now: new Date(clock) });
    expect(order.map((j) => [slotOf(j)!["day"], slotOf(j)!["start"], slotOf(j)!["by"], slotOf(j)!["person"]])).toEqual(order.map(() => ["2026-10-25", "06:15", "team", "u-kim"]));
    const t = ownerTexts();
    expect(t.length).toBe(3);
    expect(t.find((x) => x.jobId === order[0])!.body).toBe(`Hi Owner, your free Ready Check is Sunday 25 October at 6:15am with Sample Insulation. Tap to confirm: ${LINK(order[0]!)} - Home Insulation Victoria`);
    // no window claims for team times
    expect(events("run_window_claimed")).toEqual([]);
    const st = await R.ownerRunSlotState(order[0]!, { now: new Date(clock) });
    expect(st).toMatchObject({ kind: "proposed", day: "Sunday 25 October", time: "at 6:15am", free: [], team: true });
  });
  test("the owner confirms → booked through the existing path at that exact time, the chosen person assigned", async () => {
    const { runId, order } = await team(["a"]);
    const j = order[0]!;
    await R.enterTeamTime(runId, "u-sam", j, "2026-10-26", "10:45", { now: new Date(clock) });
    now(3);
    await R.ownerConfirmRunSlot(j, "u-owner", { now: new Date(clock) });
    expect(booked).toEqual([{ jobId: j, kind: "ready_check", start: "2026-10-25T23:45:00.000Z", actor: "u-owner", role: "owner (run window)" }]);
    expect(tables["job_assignments"]!.filter((a) => a["job_id"] === j && a["active"] === true).map((a) => [a["business_id"], a["user_id"]])).toEqual([["biz-1", "u-kim"]]);
    // a booked home can't be given another team time here
    await expect(R.enterTeamTime(runId, "u-sam", j, "2026-10-27", "09:00", { now: new Date(clock) })).rejects.toThrow(/already booked/);
  });
  test("a new time for a home not yet confirmed replaces the old one (new text); team times are never released at 24 h", async () => {
    const { runId, order } = await team(["a"]);
    const j = order[0]!;
    await R.enterTeamTime(runId, "u-sam", j, "2026-10-28", "09:00", { now: new Date(clock) });
    now(4);
    await R.enterTeamTime(runId, "u-sam", j, "2026-10-29", "14:00", { now: new Date(clock) });
    expect(ownerTexts().map((x) => x.body.match(/is (.*) with/)![1])).toEqual(["Wednesday 28 October at 9am", "Thursday 29 October at 2pm"]);
    await R.sweepRunSlots(at(30));
    await R.sweepRunSlots(at(60));
    expect(events("run_slot_released")).toEqual([]);
    expect(ownerTexts("run_time_reminder").length).toBe(1);
  });
  test("refused: a portal run, a home not in the run, a time already passed, a closed job (never texted)", async () => {
    const p = await offered(["a"], { batch: "bp" });
    now(2);
    await R.chooseRunDay(p.runId, "u-sam", DAY, "08:00", null, { now: new Date(clock) });
    await expect(R.enterTeamTime(p.runId, "u-sam", p.order[0]!, DAY, "10:00", { now: new Date(clock) })).rejects.toThrow(/no longer open/);
    const t = await offered(["b", "c"], { batch: "bt" });
    now(2);
    await R.chooseTeamBooks(t.runId, "u-sam", { now: new Date(clock) });
    sent.length = 0;
    await expect(R.enterTeamTime(t.runId, "u-sam", p.order[0]!, DAY, "10:00", { now: new Date(clock) })).rejects.toThrow(/isn't in this run/);
    await expect(R.enterTeamTime(t.runId, "u-sam", t.order[0]!, "2026-10-24", "09:00", { now: new Date(clock) })).rejects.toThrow(/just been taken or has passed/);
    cancelJob(t.order[1]!);
    await expect(R.enterTeamTime(t.runId, "u-sam", t.order[1]!, DAY, "10:00", { now: new Date(clock) })).rejects.toThrow();
    expect(sent).toEqual([]);
  });
  test("5 days with homes not booked → those homes back to Jo's suggestions with their standing pass, once; booked homes stay; nothing sent", async () => {
    const { runId, order } = await team(["a", "b", "c"]);
    const [x, y, z] = order as [string, string, string];
    await R.enterTeamTime(runId, "u-sam", x, "2026-10-26", "09:00", { now: new Date(clock) });
    await R.enterTeamTime(runId, "u-sam", y, "2026-10-30", "09:00", { now: new Date(clock) });
    now(3);
    await R.ownerConfirmRunSlot(x, "u-owner", { now: new Date(clock) });
    sent.length = 0;
    await R.sweepRunSlots(at(2 + 5 * 24 - 1));
    expect(events("run_slot_released")).toEqual([]);
    sent.length = 0; // (the 12-hour reminder for y went meanwhile)
    await R.sweepRunSlots(at(2 + 5 * 24 + 0.25));
    await R.sweepRunSlots(at(2 + 5 * 24 + 0.5));
    // final review I4: y's texted team time is still ahead → not withdrawn at 5 days (released only once its time passes)
    expect(events("run_slot_released").map((e) => [e["job_id"], (e["details"] as Row)["why"]])).toEqual([[z, "team_not_booked"]]);
    expect((await candidates()).map((c) => [c.jobId, c.carriedPass])).toEqual([[z, true]]);
    expect(stage(x)).toBe("ready_check_scheduled");
    expect(sent).toEqual([]);
    // the expired run takes no new times
    await expect(R.enterTeamTime(runId, "u-sam", z, "2026-11-02", "09:00", { now: new Date(clock) })).rejects.toThrow();
  });
  test("final review I4: a texted, unconfirmed team time still ahead is never withdrawn by the 5-day expiry; once its time passes it is released (time_passed), once", async () => {
    const { runId, order } = await team(["a"]);
    const j = order[0]!;
    await R.enterTeamTime(runId, "u-sam", j, "2026-10-31", "09:00", { now: new Date(clock) }); // hour 165 (Sat 31 Oct 9am)
    expect(ownerTexts().length).toBe(1);
    for (const h of [2 + 5 * 24 + 0.25, 140, 160, 164.9]) await R.sweepRunSlots(at(h));
    expect(events("run_slot_released")).toEqual([]);
    expect(await R.ownerRunSlotState(j, { now: new Date(at(150)) })).toMatchObject({ kind: "proposed", time: "at 9am", team: true });
    await R.sweepRunSlots(at(165.1));
    await R.sweepRunSlots(at(165.5));
    expect(events("run_slot_released").map((e) => [e["job_id"], (e["details"] as Row)["why"]])).toEqual([[j, "time_passed"]]);
  });
});

// ---- Move run -----------------------------------------------------------------------------------------------------------------
describe("Move run", () => {
  beforeEach(seed);
  async function chosen(ids = ["a", "b", "c"]) {
    const r = await offered(ids);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock), personId: "u-kim" });
    return r;
  }
  test("every owner gets a new window to confirm; a confirmed owner's old booking is released; window claims move", async () => {
    const { runId, order } = await chosen();
    const [a, b, c] = order as [string, string, string];
    now(3);
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    expect(stage(a)).toBe("ready_check_scheduled");
    sent.length = 0; followOns.length = 0;
    now(5);
    await R.moveRun(runId, "u-sam", "2026-10-29", "08:00", { now: new Date(clock) });
    // a's booking released through the existing change path (booking cancelled, back to "to schedule"), installer kept
    expect(tables["bookings"]!.filter((bk) => bk["job_id"] === a).map((bk) => bk["status"])).toEqual(["cancelled"]);
    expect(moved).toEqual([{ jobId: a, to: "ready_check_ready_to_schedule" }]);
    expect(tables["job_assignments"]!.filter((x) => x["job_id"] === a && x["active"] === true).map((x) => x["user_id"])).toEqual(["u-kim"]);
    // new windows in route order on the new day, same person, seq + 1
    expect([a, b, c].map((j) => [slotOf(j)!["day"], slotOf(j)!["start"], slotOf(j)!["seq"], slotOf(j)!["person"]])).toEqual([["2026-10-29", "08:00", 2, "u-kim"], ["2026-10-29", "09:00", 2, "u-kim"], ["2026-10-29", "10:00", 2, "u-kim"]]);
    expect(events("run_moved").length).toBe(3);
    // every owner texted their new window
    expect(ownerTexts().map((t) => [t.jobId, t.body.match(/is (.*) with/)![1]])).toEqual([[a, "Thursday 29 October between 8:00 and 9:00am"], [b, "Thursday 29 October between 9:00 and 10:00am"], [c, "Thursday 29 October between 10:00 and 11:00am"]]);
    // claims: the old day's are all freed, the new day's held
    const claimed = events("run_window_claimed").map((e) => e["details"] as Row);
    const freedGens = new Set(events("run_window_freed").map((e) => `${(e["details"] as Row)["day"]}|${(e["details"] as Row)["slot"]}|${(e["details"] as Row)["gen"]}`));
    expect(claimed.filter((d) => d["day"] === DAY).every((d) => freedGens.has(`${d["day"]}|${d["slot"]}|${d["gen"]}`))).toBe(true);
    expect(claimed.filter((d) => d["day"] === "2026-10-29").map((d) => d["slot"])).toEqual(["08:00", "08:30", "09:00", "09:30", "10:00", "10:30"]);
    // the owner confirms the new window → booked again through the existing path, no second assignment
    now(6);
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    expect(booked.at(-1)).toMatchObject({ jobId: a, start: "2026-10-28T21:00:00.000Z" });
    expect(followOns).toEqual([`mitti:${a}`, `owner-email:${a}`, `installer-text:${a}`]);
    expect(tables["job_assignments"]!.filter((x) => x["job_id"] === a && x["active"] === true).length).toBe(1);
  });
  test("a day under 2 days ahead is refused; nothing written, released or sent", async () => {
    const { runId, order } = await chosen(["a"]);
    now(3);
    await R.ownerConfirmRunSlot(order[0]!, "u-owner", { now: new Date(clock) });
    sent.length = 0;
    await expect(R.moveRun(runId, "u-sam", "2026-10-25", "08:00", { now: new Date(clock) })).rejects.toThrow(/at least 2 days/);
    expect(events("run_moved")).toEqual([]);
    expect(stage(order[0]!)).toBe("ready_check_scheduled");
    expect(sent).toEqual([]);
  });
  test("a cancelled home is left out and never texted; a team run can't be moved", async () => {
    const { runId, order } = await chosen(["a", "b"]);
    cancelJob(order[1]!);
    sent.length = 0;
    await R.moveRun(runId, "u-sam", "2026-10-29", "08:00", { now: new Date(clock) });
    expect(ownerTexts().map((t) => t.jobId)).toEqual([order[0]]);
    expect(events("run_moved").map((e) => e["job_id"])).toEqual([order[0]]);
    const t = await offered(["c"], { batch: "bt" });
    now(2);
    await R.chooseTeamBooks(t.runId, "u-sam", { now: new Date(clock) });
    await expect(R.moveRun(t.runId, "u-sam", "2026-10-29", "08:00", { now: new Date(clock) })).rejects.toThrow(/no longer open/);
  });
});

describe("final review I3: Move run never moves past visits", () => {
  beforeEach(seed);
  test("only windows still ahead whose job is still waiting to be / booked for its Ready Check move; past and done visits stay", async () => {
    const r = await offered(["a", "b", "c"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock), personId: "u-kim" });
    const [a, b, c] = r.order as [string, string, string];
    now(3);
    for (const j of [a, b, c]) await R.ownerConfirmRunSlot(j, "u-owner", { now: new Date(clock) });
    // Tue 27 Oct 10:30am: a's 9am visit is done (Ready Check complete), b's 10am window has started, c's 11am is ahead
    tables["jobs"]!.find((j) => j["id"] === a)!["stage"] = "ready_check_complete";
    sent.length = 0; moved.length = 0;
    now(70.5);
    const res = await R.moveRun(r.runId, "u-sam", "2026-10-29", "08:00", { now: new Date(clock) });
    expect(res.slots.map((x) => x.jobId)).toEqual([c]);
    expect(events("run_moved").map((e) => e["job_id"])).toEqual([c]);
    expect(moved).toEqual([{ jobId: c, to: "ready_check_ready_to_schedule" }]);
    expect(tables["bookings"]!.filter((bk) => bk["status"] === "confirmed").map((bk) => bk["job_id"]).sort()).toEqual([a, b].sort());
    expect([stage(a), stage(b)]).toEqual(["ready_check_complete", "ready_check_scheduled"]);
    expect(ownerTexts().map((t) => t.jobId)).toEqual([c]);
  });
  test("nothing ahead to move → refused, nothing written", async () => {
    const r = await offered(["a"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    now(3);
    await R.ownerConfirmRunSlot(r.order[0]!, "u-owner", { now: new Date(clock) });
    now(70);
    await expect(R.moveRun(r.runId, "u-sam", "2026-10-29", "08:00", { now: new Date(clock) })).rejects.toThrow(/still waiting/);
    expect(events("run_moved")).toEqual([]);
    expect(stage(r.order[0]!)).toBe("ready_check_scheduled");
  });
});

describe("final review m6: booked only while the Ready Check booking stands", () => {
  beforeEach(seed);
  test("owner's Change time cancels the booking → the run card no longer says booked and the window no longer holds the installer's time", async () => {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    const [a, b] = r.order as [string, string];
    now(3);
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    expect(await R.ownerRunSlotState(a, { now: new Date(clock) })).toMatchObject({ kind: "confirmed" });
    const before = await R.ownerRunSlotState(b, { now: new Date(clock) });
    expect(before.kind === "proposed" && before.free.map((w) => w.start)).not.toContain("09:00");
    // the owner's Change time (existing path): booking cancelled, back to "to schedule"
    await (await import("../src/lib/ready-check-times.server")).releaseBookedReadyCheck(a, "u-owner", "Ready Check time changed by the owner");
    expect(await R.ownerRunSlotState(a, { now: new Date(clock) })).toEqual({ kind: "none" });
    const after = await R.ownerRunSlotState(b, { now: new Date(clock) });
    expect(after.kind === "proposed" && after.free.map((w) => w.start)).toContain("09:00");
    await R.ownerPickRunWindow(b, "u-owner-b", "09:00", { now: new Date(clock) });
    expect(slotOf(b)).toMatchObject({ start: "09:00", seq: 2 });
  });
});

// ---- owner cancels a confirmed window ------------------------------------------------------------------------------------------
describe("owner cancels a confirmed window", () => {
  beforeEach(seed);
  async function confirmed(ids = ["a", "b"], o: { batch?: string; installer?: string; source?: string; person?: string } = {}) {
    const r = await offered(ids, o);
    now(2);
    await R.chooseRunDay(r.runId, o.person ?? "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    now(3);
    await R.ownerConfirmRunSlot(r.order[0]!, "u-owner", { now: new Date(clock) });
    sent.length = 0;
    return r;
  }
  test("the installer is told once (own type, the business owner's mobile); the owner isn't texted; the window is freed", async () => {
    const { runId, order } = await confirmed();
    const a = order[0]!;
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    expect(events("run_slot_cancelled", a).length).toBe(1);
    expect(sent).toEqual([{ via: "real-sms", to: "0411111111", type: "run_slot_cancelled", key: `run-slot-cancelled-sms:v1:${runId}:${a}:1`, jobId: a,
      body: `Hi Sam, an owner cancelled their Ready Check on Tuesday 27 October between 9:00 and 10:00am. To offer that time to a nearby waiting owner: ${SET_PASSWORD_BASE.replace(/\/+$/, "")}/field/run/${runId} - Home Insulation Victoria` }]);
    const page = await R.tradeRun(runId, "u-sam");
    expect(page.cancelled).toEqual([{ jobId: a, window: `Tuesday 27 October, ${windowWords("09:00", "10:00")}`, filledBy: null }]);
    // its half-hours are free again
    const freed = events("run_window_freed", a).map((e) => (e["details"] as Row)["slot"]);
    expect(freed.sort()).toEqual(["09:00", "09:30"]);
  });
  test("an unconfirmed window (or a home outside any run) → nobody told", async () => {
    const { order } = await confirmed();
    cancelJob(order[1]!);
    await R.runOwnerCancelled(order[1]!, { now: new Date(clock) });
    addJob("z"); cancelJob("z");
    await R.runOwnerCancelled("z", { now: new Date(clock) });
    expect(sent).toEqual([]);
    expect(events("run_slot_cancelled")).toEqual([]);
  });
  test("TEST run → the installer text goes through test-send only", async () => {
    const { order } = await confirmed(["a"], { batch: "bt", installer: "biz-t", source: "qa_test", person: "u-tess" });
    cancelJob(order[0]!);
    await R.runOwnerCancelled(order[0]!, { now: new Date(clock) });
    expect(sent.map((s) => [s.via, s.to, s.label?.startsWith("run_slot_cancelled:")])).toEqual([["test-sms", "0433333333", true]]);
  });
  test("not tapped → the slot is left alone: nobody else offered it, nothing sent, however many ticks", async () => {
    const { order } = await confirmed();
    standingPassOwner("e");
    cancelJob(order[0]!);
    await R.runOwnerCancelled(order[0]!, { now: new Date(clock) });
    sent.length = 0;
    await R.sweepRunSlots(at(4)); await R.sweepRunSlots(at(10)); await R.sweepRunSlots(at(30));
    expect(events("run_slot_proposed", "e")).toEqual([]);
    expect(sent.filter((s) => s.jobId === "e")).toEqual([]);
    expect((await candidates()).map((c) => c.jobId)).toContain("e");
  });
  test("Fill from nearby waiting owners → the nearest owner with a standing pass within 10 km gets that window (portal flow); once", async () => {
    const { runId, order } = await confirmed();
    const a = order[0]!;
    standingPassOwner("e");  // ~0.9 km away, standing pass
    standingPassOwner("f");  // far away (> 10 km)
    addJob("g");             // nearest, but never answered the quick taps (no pass)
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    sent.length = 0;
    now(4);
    const r = await R.fillCancelledSlot(runId, "u-sam", a, { now: new Date(clock) });
    expect(r).toEqual({ jobId: "e" });
    expect(await R.fillCancelledSlot(runId, "u-sam", a, { now: new Date(clock) })).toEqual({ jobId: "e" });
    expect(slotOf("e")).toMatchObject({ run_id: runId, day: DAY, start: "09:00", end: "10:00", person: "u-sam", by: "fill", seq: 1 });
    expect(events("run_slot_proposed").filter((x) => ["f", "g"].includes(String(x["job_id"])))).toEqual([]);
    expect(ownerTexts().map((t) => [t.jobId, t.body])).toEqual([["e", `Hi Owner, your free Ready Check is Tuesday 27 October between 9:00 and 10:00am with Sample Insulation. Tap to confirm or pick another time: ${LINK("e")} - Home Insulation Victoria`]]);
    // e is in the run now (not batched again), and books through the normal confirm
    expect((await candidates()).map((c) => c.jobId)).not.toContain("e");
    const page = await R.tradeRun(runId, "u-sam");
    expect(page.homes.map((h) => h.jobId)).toContain("e");
    expect(page.cancelled).toEqual([{ jobId: a, window: `Tuesday 27 October, ${windowWords("09:00", "10:00")}`, filledBy: "HV-e" }]);
    now(5);
    await R.ownerConfirmRunSlot("e", "u-owner-e", { now: new Date(clock) });
    expect(booked.at(-1)).toMatchObject({ jobId: "e", start: "2026-10-26T22:00:00.000Z" });
  });
  test("Fill: nobody with a standing pass within 10 km → refused, nothing written or sent", async () => {
    const { runId, order } = await confirmed();
    standingPassOwner("f");
    addJob("g");
    cancelJob(order[0]!);
    await R.runOwnerCancelled(order[0]!, { now: new Date(clock) });
    sent.length = 0;
    await expect(R.fillCancelledSlot(runId, "u-sam", order[0]!, { now: new Date(clock) })).rejects.toThrow(/No waiting owners nearby/);
    expect(events("run_slot_proposed").filter((x) => ["f", "g"].includes(String(x["job_id"])))).toEqual([]);
    expect(sent).toEqual([]);
  });
  test("Fill: another business can't; a window that isn't cancelled can't be filled", async () => {
    const { runId, order } = await confirmed();
    standingPassOwner("e");
    await expect(R.fillCancelledSlot(runId, "u-tess", order[0]!, { now: new Date(clock) })).rejects.toThrow();
    await expect(R.fillCancelledSlot(runId, "u-sam", order[0]!, { now: new Date(clock) })).rejects.toThrow(/not available/);
  });
});

// ---- fix round 1 ------------------------------------------------------------------------------------------------------------------
describe("fix round 1", () => {
  beforeEach(seed);
  const active = (j: string) => tables["job_assignments"]!.filter((a) => a["job_id"] === j && a["active"] === true);
  test("1: a Fill row more than 7 days after the offer never makes the offer sweep expire the run", async () => {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", "2026-11-03", "09:00", null, { now: new Date(clock) });
    now(3);
    const a = r.order[0]!;
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    standingPassOwner("e");
    now(7 * 24 + 10);
    expect(await R.fillCancelledSlot(r.runId, "u-sam", a, { now: new Date(clock) })).toEqual({ jobId: "e" });
    await R.sweepRunOffers(at(7 * 24 + 10 + 25));
    expect(events("run_expired")).toEqual([]);
    const page = await R.tradeRun(r.runId, "u-sam");
    expect(page.status).toBe("answered");
    expect(page.homes.map((h) => h.jobId)).toContain("e");
  });
  test("2: after Move run, a previously booked owner who doesn't re-confirm (none suit / 24 h) is unassigned and really back in Jo's suggestions; the Mitti form is released", async () => {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock), personId: "u-kim" });
    const [a, b] = r.order as [string, string];
    now(3);
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    await R.ownerConfirmRunSlot(b, "u-owner", { now: new Date(clock) });
    expect(active(a).length).toBe(1);
    now(5);
    await R.moveRun(r.runId, "u-sam", "2026-10-29", "08:00", { now: new Date(clock) });
    now(6);
    await R.ownerNoRunWindow(a, "u-owner", { now: new Date(clock) });
    await R.sweepRunSlots(at(31));
    await R.sweepRunSlots(at(32));
    expect(events("run_slot_released").map((e) => [e["job_id"], (e["details"] as Row)["why"]]).sort()).toEqual([[a, "none_suit"], [b, "no_confirm"]].sort());
    expect([active(a), active(b)]).toEqual([[], []]);
    expect(mittiReleased.sort()).toEqual([a, b].sort());
    expect([stage(a), stage(b)]).toEqual(["ready_check_ready_to_schedule", "ready_check_ready_to_schedule"]);
    expect((await candidates()).filter((c) => [a, b].includes(c.jobId)).map((c) => [c.jobId, c.carriedPass]).sort()).toEqual([[a, true], [b, true]].sort());
  });
  test("2b: a home never booked that the move re-windows is released as before (no unassign, no Mitti step)", async () => {
    const r = await offered(["a"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    now(5);
    await R.moveRun(r.runId, "u-sam", "2026-10-29", "08:00", { now: new Date(clock) });
    await R.ownerNoRunWindow(r.order[0]!, "u-owner", { now: new Date(clock) });
    expect(mittiReleased).toEqual([]);
    expect(events("run_slot_released").length).toBe(1);
  });
  test("3: an office Cancel of a run job runs the same hook: the installer told once", async () => {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    now(3);
    const a = r.order[0]!;
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    sent.length = 0;
    const { cancelJobFully } = await import("../src/lib/office-actions.server");
    await cancelJobFully(a, "Owner rang to cancel", "u-jo");
    expect(events("run_slot_cancelled", a).length).toBe(1);
    expect(sent.map((x) => [x.type, x.to, x.key])).toEqual([["run_slot_cancelled", "0411111111", `run-slot-cancelled-sms:v1:${r.runId}:${a}:1`]]);
    await R.runOwnerCancelled(a, { now: new Date(clock) }); // a second path (My job) → still once
    expect(events("run_slot_cancelled", a).length).toBe(1);
    expect(sent.length).toBe(1);
  });
  test("4: a held installer cancel text is retried by the tick while the slot is unfilled; once only when it actually sends", async () => {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    now(3);
    const a = r.order[0]!;
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    sent.length = 0;
    const sw = (tables["workflow_settings"]![0]!["sms_message_switches"] as Record<string, boolean>);
    sw["run_slot_cancelled"] = false;
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    await R.sweepRunSlots(at(4));
    expect(ownerTexts("run_slot_cancelled")).toEqual([]);
    sw["run_slot_cancelled"] = true;
    await R.sweepRunSlots(at(5));
    await R.sweepRunSlots(at(6));
    expect(ownerTexts("run_slot_cancelled").map((x) => x.key)).toEqual([`run-slot-cancelled-sms:v1:${r.runId}:${a}:1`]);
    expect(events("run_slot_cancelled_texted", a).length).toBe(1);
  });
  test("4b: held, then the slot is filled → the cancel text is never sent", async () => {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    now(3);
    const a = r.order[0]!;
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    const sw = (tables["workflow_settings"]![0]!["sms_message_switches"] as Record<string, boolean>);
    sw["run_slot_cancelled"] = false;
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    standingPassOwner("e");
    now(4);
    await R.fillCancelledSlot(r.runId, "u-sam", a, { now: new Date(clock) });
    sw["run_slot_cancelled"] = true;
    await R.sweepRunSlots(at(5));
    expect(ownerTexts("run_slot_cancelled")).toEqual([]);
  });
  test("5: Fill on a TEAM run adds the owner as \"to be booked by the team\": no portal window, no text; the team enters the time as for other homes", async () => {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseTeamBooks(r.runId, "u-sam", { personId: "u-kim", now: new Date(clock) });
    const a = r.order[0]!;
    await R.enterTeamTime(r.runId, "u-kim", a, DAY, "09:00", { now: new Date(clock) });
    now(3);
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    expect(ownerTexts("run_slot_cancelled").at(-1)!.body).toContain("cancelled their Ready Check on Tuesday 27 October at 9am.");
    standingPassOwner("e");
    sent.length = 0;
    now(4);
    expect(await R.fillCancelledSlot(r.runId, "u-sam", a, { now: new Date(clock) })).toEqual({ jobId: "e" });
    expect(events("run_slot_proposed", "e")).toEqual([]);
    expect(events("run_window_claimed", "e")).toEqual([]);
    expect(sent).toEqual([]);
    expect(events("run_mode_chosen", "e").map((x) => [(x["details"] as Row)["mode"], (x["details"] as Row)["person"]])).toEqual([["team", "u-kim"]]);
    const page = await R.tradeRun(r.runId, "u-sam");
    expect(page.homes.find((h) => h.jobId === "e")).toMatchObject({ slot: null });
    expect(page.cancelled).toEqual([{ jobId: a, window: "Tuesday 27 October, at 9am", filledBy: "HV-e" }]);
    await R.enterTeamTime(r.runId, "u-kim", "e", "2026-10-28", "11:30", { now: new Date(clock) });
    expect(ownerTexts().map((x) => [x.jobId, x.body])).toEqual([["e", `Hi Owner, your free Ready Check is Wednesday 28 October at 11:30am with Sample Insulation. Tap to confirm: ${LINK("e")} - Home Insulation Victoria`]]);
    now(5);
    await R.ownerConfirmRunSlot("e", "u-owner-e", { now: new Date(clock) });
    expect(booked.at(-1)).toMatchObject({ jobId: "e", start: "2026-10-28T00:30:00.000Z" });
    expect(active("e").map((x) => x["user_id"])).toEqual(["u-kim"]);
  });
  test("6: a team time that passes unconfirmed → released to the pool once on the tick", async () => {
    const r = await offered(["a"]);
    now(2);
    await R.chooseTeamBooks(r.runId, "u-sam", { now: new Date(clock) });
    const a = r.order[0]!;
    await R.enterTeamTime(r.runId, "u-sam", a, "2026-10-26", "09:00", { now: new Date(clock) });
    await R.sweepRunSlots(at(44)); // before the time (Monday 9am Melbourne = 45 h after T0)
    expect(events("run_slot_released")).toEqual([]);
    await R.sweepRunSlots(at(46));
    await R.sweepRunSlots(at(47));
    expect(events("run_slot_released").map((e) => [e["job_id"], (e["details"] as Row)["why"]])).toEqual([[a, "time_passed"]]);
    expect((await candidates()).filter((c) => c.jobId === a).map((c) => c.carriedPass)).toEqual([true]);
    expect(await R.ownerRunSlotState(a, { now: new Date(clock) })).toEqual({ kind: "none" });
  });
});

// ---- Task 9 pre-final cleanup ------------------------------------------------------------------------------------------------
describe("Task 9 cleanup", () => {
  beforeEach(seed);
  const active = (j: string) => tables["job_assignments"]!.filter((a) => a["job_id"] === j && a["active"] === true);
  const cancelAttempts = () => realAttempts.filter((x) => x.type === "run_slot_cancelled").length;
  async function cancelledConfirmed() {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock) });
    now(3);
    const a = r.order[0]!;
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    sent.length = 0;
    return { r, a };
  }
  const ws = () => tables["workflow_settings"]![0]!;
  const sw = () => ws()["sms_message_switches"] as Record<string, boolean>;

  test("held cancel text: while run_slot_cancelled is switched off the tick never calls the sender (no held row per tick); switched on → sent once", async () => {
    const { r, a } = await cancelledConfirmed();
    sw()["run_slot_cancelled"] = false;
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    const first = cancelAttempts(); // the owner's cancel itself tries once (recorded held for the office)
    await R.sweepRunSlots(at(4)); await R.sweepRunSlots(at(5)); await R.sweepRunSlots(at(6));
    expect(cancelAttempts()).toBe(first);
    sw()["run_slot_cancelled"] = true;
    await R.sweepRunSlots(at(7)); await R.sweepRunSlots(at(8));
    expect(ownerTexts("run_slot_cancelled").map((x) => x.key)).toEqual([`run-slot-cancelled-sms:v1:${r.runId}:${a}:1`]);
    expect(events("run_slot_cancelled_texted", a).length).toBe(1);
  });
  test("held cancel text: customer messages off, or trade messages paused → the tick doesn't call the sender either; retried once allowed", async () => {
    const { r, a } = await cancelledConfirmed();
    ws()["customer_comms_enabled"] = false;
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    const first = cancelAttempts();
    await R.sweepRunSlots(at(4));
    expect(cancelAttempts()).toBe(first);
    ws()["customer_comms_enabled"] = true;
    ws()["trade_messages_paused"] = true;
    await R.sweepRunSlots(at(5)); await R.sweepRunSlots(at(6));
    expect(cancelAttempts()).toBe(first);
    expect(ownerTexts("run_slot_cancelled")).toEqual([]);
    ws()["trade_messages_paused"] = false;
    await R.sweepRunSlots(at(7));
    expect(ownerTexts("run_slot_cancelled").map((x) => x.key)).toEqual([`run-slot-cancelled-sms:v1:${r.runId}:${a}:1`]);
  });

  async function movedBooked() {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseRunDay(r.runId, "u-sam", DAY, "09:00", null, { now: new Date(clock), personId: "u-kim" });
    const [a, b] = r.order as [string, string];
    now(3);
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    await R.ownerConfirmRunSlot(b, "u-owner", { now: new Date(clock) });
    now(5);
    await R.moveRun(r.runId, "u-sam", "2026-10-29", "08:00", { now: new Date(clock) });
    now(6);
    return { r, a, b };
  }
  test("moved booking released: the Mitti form is released only when the update really ended this business's assignment", async () => {
    const { a, b } = await movedBooked();
    // a: the office already ended the assignment; b: the assignment is another business's.
    for (const x of active(a)) x["active"] = false;
    for (const x of active(b)) x["business_id"] = "biz-other";
    await R.ownerNoRunWindow(a, "u-owner", { now: new Date(clock) });
    await R.ownerNoRunWindow(b, "u-owner", { now: new Date(clock) });
    expect(events("run_slot_released").length).toBe(2);
    expect(mittiReleased).toEqual([]);
    expect(active(b).map((x) => x["business_id"])).toEqual(["biz-other"]);
  });
  test("moved booking released: an assignment update that fails → no Mitti release (the release itself still stands)", async () => {
    const { a } = await movedBooked();
    failUpdates.add("job_assignments");
    await R.ownerNoRunWindow(a, "u-owner", { now: new Date(clock) });
    expect(events("run_slot_released", a).length).toBe(1);
    expect(mittiReleased).toEqual([]);
    failUpdates.clear();
  });
  test("moved booking released: a real end of the assignment still releases the Mitti form (once)", async () => {
    const { a } = await movedBooked();
    await R.ownerNoRunWindow(a, "u-owner", { now: new Date(clock) });
    expect(active(a)).toEqual([]);
    expect(mittiReleased).toEqual([a]);
  });

  test("team Fill: the Fill row written but the home's own run_mode_chosen missing (crash) → a repeat tap writes it, once", async () => {
    const r = await offered(["a", "b"]);
    now(2);
    await R.chooseTeamBooks(r.runId, "u-sam", { personId: "u-kim", now: new Date(clock) });
    const a = r.order[0]!;
    await R.enterTeamTime(r.runId, "u-kim", a, DAY, "09:00", { now: new Date(clock) });
    now(3);
    await R.ownerConfirmRunSlot(a, "u-owner", { now: new Date(clock) });
    cancelJob(a);
    await R.runOwnerCancelled(a, { now: new Date(clock) });
    standingPassOwner("e");
    sent.length = 0;
    now(4);
    expect(await R.fillCancelledSlot(r.runId, "u-sam", a, { now: new Date(clock) })).toEqual({ jobId: "e" });
    // The crash: the Fill row is there, e's own choice row isn't.
    tables["workflow_events"] = tables["workflow_events"]!.filter((e) => !(e["event_type"] === "run_mode_chosen" && e["job_id"] === "e"));
    expect(await R.fillCancelledSlot(r.runId, "u-sam", a, { now: new Date(clock) })).toEqual({ jobId: "e" });
    expect(await R.fillCancelledSlot(r.runId, "u-sam", a, { now: new Date(clock) })).toEqual({ jobId: "e" });
    expect(events("run_mode_chosen", "e").map((x) => [(x["details"] as Row)["mode"], (x["details"] as Row)["person"], (x["details"] as Row)["filled_from"]])).toEqual([["team", "u-kim", a]]);
    expect(events("run_offered", "e").length).toBe(1);
    expect(sent).toEqual([]);
    await R.enterTeamTime(r.runId, "u-kim", "e", "2026-10-28", "11:30", { now: new Date(clock) });
    expect(ownerTexts().map((x) => x.jobId)).toEqual(["e"]);
  });
});

// ---- wiring ---------------------------------------------------------------------------------------------------------------------
describe("wiring", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  test("the owner's own cancel (My job) runs the run hook; the run page has the three new controls", () => {
    expect(src("src/lib/owner-myjob.server.ts")).toContain("runOwnerCancelled");
    // every cancel (office, email, quote expiry, quick taps) goes through releaseCancelledJob, which runs the same hook
    expect(src("src/lib/office-actions.server.ts")).toContain("runOwnerCancelled");
    // the owner's team-time card: Confirm / Can't make it only, booked line without a comma
    const card = src("src/components/owner/OwnerRunTime.tsx");
    expect(card).toContain("data-run-team-cant");
    expect(card).toContain("Your Ready Check is booked for {data.day} {data.time}.");
    const page = src("src/routes/_authenticated/field.run.$runId.tsx");
    expect(page).toContain("Fill from nearby waiting owners");
    expect(page).toContain("Move run");
    expect(page).not.toMatch(/disabled data-run-team/);
  });
  test("server functions: literal chains, business-scoped through the run page reads", () => {
    const f = src("src/lib/installer-run.functions.ts");
    for (const fn of ["chooseTradeRunTeam", "enterTradeRunTime", "moveTradeRun", "fillTradeRunSlot"]) expect(f).toContain(`export const ${fn} = createServerFn(`);
  });
  test("nothing lands in Needs me", () => {
    expect(src("src/lib/installer-run.server.ts")).not.toMatch(/needs_office|visit_needs_office/);
  });
});
