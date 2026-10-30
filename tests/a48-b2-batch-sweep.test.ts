// A48 batch 2, Task 4: the batch sweep on the 15-minute tick, on an in-memory fake database with recorded fake senders.
// Covers: day-2 reminder once per non-answerer (quiet hours wait for the next tick outside them; TEST → test-send),
// day-3 close (`area_batch_closed {batch_id, pass_job_ids, freed_job_ids}`), non-answerers back in the pool, homes that
// LEFT the batch and closed/cancelled jobs skipped, passers "ready for your OK" (never sent to an installer
// automatically, never put in another batch), zero passers → nothing waiting, decline answers whose close failed are
// finished again (finishDecline), day 14 from the first send with no answer → job closed quietly, nothing in Needs me.
// Also: "It's your turn" retired for website owners (Release refused unless the owner already confirmed).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { AREA_BATCH_EVENTS, NO_ANSWER_CLOSE_REASON, quickTapsReminderText } from "../src/lib/area-batch.core";
import { RELEASE_RETIRED_REASON, releasePlan } from "../src/lib/spot-release.core";

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
            const det = (payload?.["details"] ?? {}) as Row;
            if (table === "workflow_events" && (AREA_BATCH_EVENTS as readonly string[]).includes(String(payload?.["event_type"])) && det["idempotency_key"] && rows.some((r) => r["event_type"] === payload?.["event_type"] && (r["details"] as Row)?.["idempotency_key"] === det["idempotency_key"]))
              out = { data: null, error: { message: "duplicate key", code: "23505" } };
            else { const row = { id: crypto.randomUUID(), created_at: new Date(++clock).toISOString(), ...payload! }; rows.push(row); out = { data: one ? row : [row], error: null }; }
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
const sent: { via: string; to: string; body: string; key?: string; type?: string; label?: string }[] = [];
let smsStatus = "sent"; // what the real sender answers ("blocked" = held: switch off, quiet hours…)
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (i: { type: string; to: string; body: string; idempotencyKey: string }) => {
    if (smsStatus !== "sent") return { status: smsStatus, detail: "held", sid: null };
    sent.push({ via: "real-sms", to: i.to, body: i.body, key: i.idempotencyKey, type: i.type }); return { status: "sent", detail: "ok", sid: "SM1" };
  },
}));
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async () => { throw new Error("no email from the sweep"); },
  sendTestSms: async (c: { label: string }, to: string, body: string) => { sent.push({ via: "test-sms", to, body, label: c.label }); return { status: "sent", detail: "ok" }; },
}));
mock.module("../src/lib/veec-copy-email.server", () => ({ ownerMyJobLink: async (jobId: string) => `https://estimate.homeinsulationvictoria.com.au/my-job/T-${jobId}` }));
const finished: string[] = [];
let finishResult = "finished";
mock.module("../src/lib/quick-taps.server", () => ({ finishDecline: async (jobId: string) => { finished.push(jobId); return finishResult; } }));
let cancelLeavesOpen = false; // the office reopened the job straight after (or the cancel didn't stick)
const cancels: { jobId: string; reason: string; tell: unknown }[] = [];
mock.module("../src/lib/office-actions.server", () => ({
  cancelJobFully: async (jobId: string, reason: string, _a: string | null, opts: { tell?: unknown } = {}) => {
    cancels.push({ jobId, reason, tell: opts.tell });
    if (!cancelLeavesOpen) tables["jobs"]!.find((j) => j["id"] === jobId)!["stage"] = "cancelled";
  },
}));
mock.module("../src/lib/installer-waiting.server", () => ({ installerFacts: async () => [] }));
mock.module("../src/lib/property-coordinates.server", () => ({ ensurePropertyCoordinates: async () => null }));

const S = await import("../src/lib/area-batch.server");

// ---- fixtures ---------------------------------------------------------------------------------------------------
const H = 3_600_000;
const T0 = Date.parse("2026-10-20T01:00:00.000Z"); // 12pm Melbourne
const at = (hours: number) => new Date(T0 + hours * H).toISOString();
const GOOD = { declared: { property_type: "house", over_five_years: "yes" }, answers: { insulation: "none" } };

function addJob(id: string, o: { source?: string; stage?: string; name?: string } = {}) {
  tables["jobs"]!.push({
    id, job_number: `HV-${id}`, stage: o.stage ?? "ready_check_ready_to_schedule", source: o.source ?? "website", channel: "hivic_sourced",
    deleted_at: null, qa_archived_at: null, property_id: `p-${id}`, created_at: "2026-10-01T00:00:00Z",
    owners: { full_name: o.name ?? `Owner ${id}`, phone: `04000000${id.length}` },
    properties: { address_line: "1 Sample Street", suburb: "Melbourne", postcode: "3000", ...GOOD },
  });
  tables["lead_campaign_responses"]!.push({ job_id: id, spot_saved_at: "2026-10-01T00:00:00Z", opted_out_at: null, saved_insulation: null });
  tables["property_facts"]!.push({ property_id: `p-${id}`, fact_key: "coordinates", value: [145, -37.8], is_current: true });
}
const ev = (jobId: string, type: string, hours: number, details: Row) => tables["workflow_events"]!.push({ id: crypto.randomUUID(), job_id: jobId, event_type: type, created_at: at(hours), details });
function sendBatch(batchId: string, jobIds: string[], hours = 0, installer = { id: "biz-1", name: "Sample Insulation" }, carried: string[] = []) {
  for (const j of jobIds) ev(j, "area_batch_sent", hours, { batch_id: batchId, installer_business_id: installer.id, installer_name: installer.name, job_ids: jobIds, idempotency_key: `area-batch:v1:${j}:${batchId}`, ...(carried.includes(j) ? { carried_pass: true } : {}) });
}
const answer = (jobId: string, batchId: string, outcome: string, hours = 1) => ev(jobId, "quick_taps_answered", hours, { batch_id: batchId, outcome, consent_share: outcome === "pass" });
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  sent.length = 0; finished.length = 0; cancels.length = 0; smsStatus = "sent"; finishResult = "finished"; cancelLeavesOpen = false;
  for (const t of ["jobs", "lead_campaign_responses", "property_facts", "job_assignments", "partner_offers", "workflow_events"]) tables[t] = [];
  tables["businesses"] = [{ id: "biz-1", name: "Sample Insulation", onboarding_notes: null }, { id: "biz-t", name: "[TEST PARTNER] Co", onboarding_notes: "[TEST PARTNER]" }];
}
const events = (type?: string, jobId?: string) => (tables["workflow_events"] ?? []).filter((e) => (!type || e["event_type"] === type) && (!jobId || e["job_id"] === jobId));
/** a passes, b no answer, c cancelled (no answer), d left the batch (address moved). */
function standardBatch() {
  for (const id of ["a", "b", "c", "d"]) addJob(id);
  tables["jobs"]!.find((j) => j["id"] === "c")!["stage"] = "cancelled";
  sendBatch("b1", ["a", "b", "c", "d"]);
  answer("a", "b1", "pass");
  ev("d", "area_batch_left", 2, { batch_id: "b1", reason: "address_moved" });
}

// ---- day-2 reminder ----------------------------------------------------------------------------------------------
describe("day-2 reminder", () => {
  beforeEach(seed);
  test("nothing before 48 hours; at day 2 ONE reminder to each non-answerer (exact approved text), never twice", async () => {
    standardBatch();
    await S.sweepAreaBatches(at(47));
    expect(sent).toEqual([]);
    await S.sweepAreaBatches(at(49));
    expect(sent).toEqual([{ via: "real-sms", type: "quick_taps_reminder", to: "040000001", key: "quick-taps:v1:b1:b:reminder",
      body: quickTapsReminderText("Owner b", "https://estimate.homeinsulationvictoria.com.au/my-job/T-b?screen=taps") }]);
    expect(events("quick_taps_reminded").map((e) => e["job_id"])).toEqual(["b"]);
    await S.sweepAreaBatches(at(50));
    await S.sweepAreaBatches(at(51));
    expect(sent.length).toBe(1);
  });
  test("quiet hours: waits, then goes at the next tick outside them", async () => {
    addJob("b"); sendBatch("b1", ["b"]);
    await S.sweepAreaBatches(at(57)); // 9pm Melbourne
    expect(sent).toEqual([]);
    expect(events("quick_taps_reminded")).toEqual([]);
    await S.sweepAreaBatches(at(66.5)); // 6:30am Melbourne — still quiet
    expect(sent).toEqual([]);
    await S.sweepAreaBatches(at(67.5)); // 7:30am Melbourne
    expect(sent.map((s) => s.key)).toEqual(["quick-taps:v1:b1:b:reminder"]);
  });
  test("TEST job → test-send only", async () => {
    addJob("t", { source: "qa_test" }); sendBatch("b1", ["t"], 0, { id: "biz-t", name: "[TEST PARTNER] Co" });
    await S.sweepAreaBatches(at(49));
    expect(sent.map((s) => s.via)).toEqual(["test-sms"]);
    expect(sent[0]!.body).toContain("/my-job/T-t?screen=taps");
  });
  test("owner who answered, left the batch, or whose job was closed meanwhile is never reminded", async () => {
    standardBatch();
    await S.sweepAreaBatches(at(49));
    expect(sent.map((s) => s.key)).toEqual(["quick-taps:v1:b1:b:reminder"]);
  });
});

// ---- day-3 close ----------------------------------------------------------------------------------------------------
describe("day-3 close", () => {
  beforeEach(seed);
  test("area_batch_closed with the passers; non-answerers freed; left and cancelled homes in neither list; nothing sent", async () => {
    standardBatch();
    await S.sweepAreaBatches(at(71));
    expect(events("area_batch_closed")).toEqual([]);
    sent.length = 0;
    await S.sweepAreaBatches(at(73));
    const closed = events("area_batch_closed");
    expect(closed.map((e) => e["job_id"]).sort()).toEqual(["a", "b", "c", "d"]);
    for (const e of closed) expect(e["details"]).toMatchObject({ batch_id: "b1", pass_job_ids: ["a"], freed_job_ids: ["b"] });
    expect(sent).toEqual([]);
    // Runs never go to an installer automatically: nothing offered, nothing in Needs me.
    expect(events().some((e) => /run_offered|offer/.test(String(e["event_type"])))).toBe(false);
    expect(events().some((e) => (e["details"] as Row)?.["needs_office"])).toBe(false);
    expect(tables["partner_offers"]).toEqual([]);
    // Again → nothing new.
    await S.sweepAreaBatches(at(74));
    expect(events("area_batch_closed").length).toBe(4);
  });
  test("a non-answerer is back in the pool (no new text until a new batch); a passer is not (waiting for Jo's OK)", async () => {
    standardBatch();
    await S.sweepAreaBatches(at(73));
    expect(await S.openBatchFor("b")).toBeNull();
    const r = await S.batchCandidates({ now: new Date(at(73)) });
    expect(r.candidates.map((c) => c.jobId).sort()).toEqual(["b", "d"]);
    expect(r.refused.get("a")).toMatch(/send to installer/i);
    sent.length = 0;
    await S.sweepAreaBatches(at(100));
    expect(sent).toEqual([]);
  });
  test("closed batch with passers is ready for Jo's OK: passers, suburb and the installer she picked", async () => {
    standardBatch();
    await S.sweepAreaBatches(at(73));
    expect(await S.batchesReadyToSend({ now: new Date(at(74)) })).toEqual([{
      batchId: "b1", closedAt: expect.any(String), isTest: false, installer: { id: "biz-1", name: "Sample Insulation" },
      homes: [{ jobId: "a", jobNumber: "HV-a", ownerName: "Owner a", suburb: "Melbourne", postcode: "3000" }],
    }]);
  });
  test("zero passers → closed, nothing waiting for an installer", async () => {
    addJob("x"); addJob("y"); sendBatch("b2", ["x", "y"]); answer("y", "b2", "no_thanks");
    tables["jobs"]!.find((j) => j["id"] === "y")!["stage"] = "cancelled";
    await S.sweepAreaBatches(at(73));
    expect(events("area_batch_closed").map((e) => (e["details"] as Row)["pass_job_ids"])).toEqual([[], []]);
    expect(await S.batchesReadyToSend({ now: new Date(at(74)) })).toEqual([]);
  });
  test("a passer whose job was cancelled before the close is not a passer", async () => {
    addJob("a"); sendBatch("b1", ["a"]); answer("a", "b1", "pass");
    tables["jobs"]!.find((j) => j["id"] === "a")!["stage"] = "cancelled";
    await S.sweepAreaBatches(at(73));
    expect((events("area_batch_closed")[0]!["details"] as Row)["pass_job_ids"]).toEqual([]);
  });
});

// ---- decline retries --------------------------------------------------------------------------------------------------
describe("decline whose close failed", () => {
  beforeEach(seed);
  test("finishDecline runs again for a decline answer on a job not yet cancelled; never for a cancelled job or a pass", async () => {
    for (const id of ["e", "f", "g"]) addJob(id);
    sendBatch("b1", ["e", "f", "g"]);
    answer("e", "b1", "decline_access");
    answer("f", "b1", "decline_5yr"); tables["jobs"]!.find((j) => j["id"] === "f")!["stage"] = "cancelled";
    answer("g", "b1", "pass");
    await S.sweepAreaBatches(at(5));
    expect(finished).toEqual(["e"]);
    expect(events().some((e) => (e["details"] as Row)?.["needs_office"])).toBe(false);
  });
});

// ---- day 14 -------------------------------------------------------------------------------------------------------------
describe("day 14 from the first send with no answer", () => {
  beforeEach(seed);
  test("closed quietly (no message to anyone); 13 days → nothing; answered → nothing", async () => {
    addJob("n"); addJob("p"); addJob("q");
    sendBatch("b1", ["n", "p"]); answer("p", "b1", "pass");
    sendBatch("b9", ["q"], 30); // first sent 30 hours later
    await S.sweepAreaBatches(at(13 * 24 + 2));
    expect(cancels).toEqual([]);
    sent.length = 0;
    await S.sweepAreaBatches(at(14 * 24 + 1));
    expect(cancels).toEqual([{ jobId: "n", reason: NO_ANSWER_CLOSE_REASON, tell: { owner: false, installer: false } }]);
    expect(sent).toEqual([]);
    await S.sweepAreaBatches(at(14 * 24 + 2));
    expect(cancels.length).toBe(1);
  });
  test("counted from the FIRST send, even when the owner is now in a newer batch", async () => {
    addJob("n");
    sendBatch("b1", ["n"]);
    await S.sweepAreaBatches(at(73)); // freed
    sendBatch("b2", ["n"], 12 * 24);
    await S.sweepAreaBatches(at(14 * 24 + 1));
    expect(cancels.map((c) => c.jobId)).toEqual(["n"]);
  });
});

// ---- wiring + retired release ---------------------------------------------------------------------------------------------
describe("wiring", () => {
  test("the 15-minute tick runs the batch sweep", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain("sweepAreaBatches");
  });
  test("nothing in the sweep offers a run to an installer", () => {
    const src = readFileSync("src/lib/area-batch.server.ts", "utf8");
    expect(src).not.toMatch(/offerRun|run_offered/);
  });
});

describe("\"It's your turn\" retired for website owners", () => {
  const base = { testJob: false, emailApproved: true, smsApproved: true, hasRateCard: true };
  test("Release refuses (for TEST and real jobs); a lapsed release can't be released again either", () => {
    expect(releasePlan({ ...base, state: { state: "none" } })).toEqual({ mode: "refused", reason: RELEASE_RETIRED_REASON });
    expect(releasePlan({ ...base, testJob: true, state: { state: "none" } })).toEqual({ mode: "refused", reason: RELEASE_RETIRED_REASON });
    expect(releasePlan({ ...base, state: { state: "lapsed", seq: 1, businessId: "b", businessName: "B", releasedAt: "2026-09-30T00:00:00Z", releasedBy: null, at: "2026-10-01T00:00:00Z" } })).toEqual({ mode: "refused", reason: RELEASE_RETIRED_REASON });
  });
  test("an owner who already confirmed (history) still goes straight to the installer", () => {
    expect(releasePlan({ ...base, state: { state: "confirmed", seq: 1, businessId: "b", businessName: "B", releasedAt: "2026-09-30T00:00:00Z", releasedBy: null, at: "2026-10-01T00:00:00Z" } })).toEqual({ mode: "direct_offer" });
  });
  test("the Choose installer panel shows Release only for an owner who already confirmed", () => {
    const src = readFileSync("src/components/portal/choose-installer.tsx", "utf8");
    expect(src).toContain("confirmed && (");
    expect(src).toContain("Send to installer");
  });
});

// ---- fix round 1 ---------------------------------------------------------------------------------------------------------
describe("a pass from a batch the owner left is carried forward", () => {
  beforeEach(seed);
  test("left b1, then passed its taps → not a b1 passer, but a batch candidate again (not lost)", async () => {
    addJob("d"); addJob("a"); sendBatch("b1", ["a", "d"]);
    ev("d", "area_batch_left", 2, { batch_id: "b1", reason: "address_moved" });
    answer("d", "b1", "pass", 3);
    await S.sweepAreaBatches(at(73));
    expect((events("area_batch_closed", "d")[0]!["details"] as Row)["pass_job_ids"]).toEqual([]);
    const r = await S.batchCandidates({ now: new Date(at(74)) });
    expect(r.candidates.map((c) => c.jobId)).toContain("d");
    // Never day-14 closed: the owner answered.
    await S.sweepAreaBatches(at(15 * 24));
    expect(cancels.map((c) => c.jobId)).toEqual(["a"]); // a never answered; d did
  });
  test("an answer that raced the close (pass recorded, but freed) is carried forward too", async () => {
    addJob("a"); sendBatch("b1", ["a"]);
    await S.sweepAreaBatches(at(73));
    answer("a", "b1", "pass", 73.5);
    expect((await S.batchCandidates({ now: new Date(at(74)) })).candidates.map((c) => c.jobId)).toEqual(["a"]);
  });
  test("carried into a new batch: never reminded, counted as a passer at that batch's close", async () => {
    addJob("d"); addJob("e"); sendBatch("b1", ["d"]); ev("d", "area_batch_left", 2, { batch_id: "b1", reason: "address_moved" }); answer("d", "b1", "pass", 3);
    sendBatch("b2", ["d", "e"], 80, undefined, ["d"]);
    await S.sweepAreaBatches(at(80 + 60)); // 8am Melbourne, day 2.5 of b2
    expect(sent.map((x) => x.key)).toEqual(["quick-taps:v1:b2:e:reminder"]);
    await S.sweepAreaBatches(at(80 + 73));
    expect(events("area_batch_closed").filter((e) => (e["details"] as Row)["batch_id"] === "b2").map((e) => (e["details"] as Row)["pass_job_ids"])).toEqual([["d"], ["d"]]);
    expect(events("area_batch_closed", "d").filter((e) => (e["details"] as Row)["batch_id"] === "b2")[0]!["details"]).toMatchObject({ freed_job_ids: ["e"] });
  });
  test("a passer handed on in a close's pass list stays out of new batches", async () => {
    addJob("a"); sendBatch("b1", ["a"]); answer("a", "b1", "pass");
    await S.sweepAreaBatches(at(73));
    expect((await S.batchCandidates({ now: new Date(at(74)) })).refused.get("a")).toMatch(/send to installer/i);
  });
});

describe("decline retry and day-14 close happen once, and never re-close a reopened job", () => {
  beforeEach(seed);
  test("decline retry runs once per job + batch; a failed close counts as failed", async () => {
    addJob("e"); sendBatch("b1", ["e"]); answer("e", "b1", "decline_access");
    finishResult = "cancel_failed";
    const r = await S.sweepAreaBatches(at(5));
    expect(r.failed).toBe(1);
    await S.sweepAreaBatches(at(5.25));
    expect(finished).toEqual(["e"]);
  });
  test("a declined job the office reopened (stage change after the answer) is not closed again", async () => {
    addJob("e"); sendBatch("b1", ["e"]); answer("e", "b1", "no_thanks", 1);
    ev("e", "stage_changed", 4, { reason: "reopened" });
    await S.sweepAreaBatches(at(5));
    expect(finished).toEqual([]);
  });
  test("day-14 close is claimed once: a job reopened straight after is not cancelled again", async () => {
    addJob("n"); sendBatch("b1", ["n"]);
    cancelLeavesOpen = true;
    await S.sweepAreaBatches(at(14 * 24 + 1));
    await S.sweepAreaBatches(at(14 * 24 + 2));
    expect(cancels.map((c) => c.jobId)).toEqual(["n"]);
    expect(events("quick_taps_no_answer_closed", "n")).toHaveLength(1);
  });
  test("a job reopened after its first send (stage change) is not day-14 closed", async () => {
    addJob("n"); sendBatch("b1", ["n"]);
    ev("n", "stage_changed", 100, { reason: "reopened" });
    await S.sweepAreaBatches(at(14 * 24 + 1));
    expect(cancels).toEqual([]);
  });
});

describe("day-2 reminder claimed only once it went", () => {
  beforeEach(seed);
  test("held (switch off) → not claimed; a later tick sends it and claims it once", async () => {
    addJob("b"); sendBatch("b1", ["b"]);
    smsStatus = "blocked";
    await S.sweepAreaBatches(at(49));
    expect(events("quick_taps_reminded")).toEqual([]);
    smsStatus = "sent";
    await S.sweepAreaBatches(at(50));
    await S.sweepAreaBatches(at(51));
    expect(sent.map((x) => x.key)).toEqual(["quick-taps:v1:b1:b:reminder"]);
    expect(events("quick_taps_reminded")).toHaveLength(1);
  });
});
