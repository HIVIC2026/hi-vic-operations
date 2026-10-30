import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as inHouse from "../src/lib/in-house.core";
import * as autoCore from "../src/lib/auto-offer.core";
import * as decisions from "../src/config/workflow-decisions";

// Real helpers with isolated database/provider doubles. No hosted writes or delivery.
function fixture() {
  let flagged = true;
  let readFailure = false;
  const calls: { table: string; filters: unknown[][]; select: string }[] = [];
  const writes: string[] = [];
  const sends: string[] = [];
  const data: Record<string, any[]> = {
    jobs: [{ id: "j", stage: "ready_check_ready_to_schedule", channel: "hivic_sourced", source: "base44", deleted_at: null }],
    partner_offers: [{ id: "offer", job_id: "j", kind: "ready_check", status: "pending", business_id: "b", offered_at: "2026-10-30T00:00:00Z", expires_at: "2030-01-01T00:00:00Z" }],
    job_assignments: [],
    businesses: [{ id: "b", onboarding_notes: null, coverage_lat: null, coverage_lng: null }],
    contact_releases: [{ job_id: "j", visit_kind: "piesa", released_at: "2020-01-01T00:00:00Z", assignment_id: "asg", job_assignments: { active: true, booking_confirmed_at: null } }],
  };
  const admin = { from(table: string) {
    const call = { table, filters: [] as unknown[][], select: "" }; calls.push(call);
    let single = false; let head = false; let mutation = false;
    const q: any = { then(resolve: (value: unknown) => unknown) {
      if (mutation) writes.push(table);
      let rows = data[table] ?? [];
      const stateRead = table === "job_assignments" && call.select.includes("in_house");
      if (stateRead) rows = [{ job_id: "j", business_id: "b", businesses: { in_house: flagged }, jobs: { deleted_at: null, source: "base44" } }];
      for (const [key, col, val] of call.filters) {
        if (typeof col !== "string" || col.includes(".") || !(col in (rows[0] ?? {}))) continue;
        if (key === "eq") rows = rows.filter(r => r[col] === val);
        if (key === "in") rows = rows.filter(r => (val as unknown[]).includes(r[col]));
        if (key === "is") rows = rows.filter(r => r[col] === val);
      }
      return Promise.resolve({ data: head ? null : single ? rows[0] ?? null : rows, count: rows.length, error: stateRead && readFailure ? { message: "state unavailable" } : null }).then(resolve);
    } };
    q.select = (s: string, opts?: { head?: boolean }) => { call.select = s; head = !!opts?.head; return q; };
    for (const name of ["eq", "in", "is", "neq", "not", "lt", "gt", "gte", "order", "limit", "contains"]) q[name] = (...args: unknown[]) => { call.filters.push([name, ...args]); return q; };
    for (const name of ["single", "maybeSingle"]) q[name] = () => { single = true; return q; };
    for (const name of ["insert", "update", "upsert", "delete"]) q[name] = () => { mutation = true; return q; };
    return q;
  }, async rpc(name: string) { writes.push(name); return { data: true, error: null }; } };
  const cache: Record<string, any> = {};
  const workflow = { WorkflowError: class extends Error {}, logEvent: async () => { writes.push("event"); }, piesaRequestFacts: async () => ({}), stageEntryBlockers: async () => [] };
  const overrides: Record<string, any> = {
    "@/integrations/supabase/client.server": { supabaseAdmin: admin }, "./in-house.core": inHouse,
    "@/config/workflow-decisions": decisions,
    "./auto-offer.core": autoCore, "./workflow.server": workflow,
    "./spot-release.server": { spotReleaseStateFor: async () => ({ state: "confirmed" }) },
    "./readycheck-booking.server": { installerCandidatesFor: async () => ({ postcode: null, candidates: [{ business_id: "b", name: "Rapid", coverage_verified: true, covers_postcode: true, has_valid_licence: true, approved_workers: 1 }] }) },
    "@/data/vic-postcode-centroids.json": { default: {} }, "./test-send.core": { isTestPartner: () => false },
    "./ready-check-times-email.server": { emailOwnerReadyCheckTimes: async () => { sends.push("ready_check"); return "sent"; } },
    "./approved-owner-emails.server": { emailOwnerSafetyCheckTimes: async () => { sends.push("piesa"); return "sent"; } },
  };
  function load(file: string, extra = "") {
    const source = ts.transpile(readFileSync(`src/lib/${file}.ts`, "utf8") + extra, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 });
    const out: any = {};
    new Function("exports", "require", source)(out, (name: string) => {
      if (name in overrides) return overrides[name];
      if (name.startsWith("./")) {
        const dep = name.slice(2);
        if (!(dep in cache)) cache[dep] = load(dep);
        return cache[dep];
      }
      if (name === "@/lib/melbourne-time.core") return { melbourneToday: () => "2026-10-30" };
      throw new Error(`Unexpected dependency ${name}`);
    });
    return out;
  }
  return { load, data, calls, writes, sends, overrides, setFlag: (v: boolean) => { flagged = v; }, failRead: () => { readFailure = true; } };
}
const switches = { ready_check: true, piesa: true, readyCheckBooking: true };

test("held means active installer business flag only", () => {
  const held = (inHouse as any).jobHeldByInHousePartner;
  expect(held({ activeInstallerBusiness: { in_house: true } })).toBe(true);
  expect(held({ activeInstallerBusiness: { in_house: false } })).toBe(false);
  expect(held({ activeInstallerBusiness: null })).toBe(false);
});
test("automatic offer skips in-house without any write", async () => {
  const f = fixture();
  expect(await f.load("auto-offer.server").autoOfferForJob("j", "ready_check", switches)).toMatchObject({ skipped: "in_house" });
  expect(f.writes).toEqual([]);
});
test("PIESA start skips before healing, gates or offer claims", async () => {
  const f = fixture();
  expect(await f.load("allocation.server").startPiesaAllocation("j", "office")).toMatchObject({ offered: 0, skipped: "in_house" });
  expect(f.writes).toEqual([]);
});
test("owner old PIESA windows early return without writes", async () => {
  const f = fixture();
  expect(await f.load("allocation.server").submitOwnerPiesaWindows("j", "owner", [], {})).toMatchObject({ skipped: "in_house" });
  expect(f.writes).toEqual([]);
});
test("stale Ready Check offer cannot accept or email an in-house owner", async () => {
  const f = fixture();
  expect(await f.load("ready-check-times.server").acceptOfferWithTimes("offer", "installer", [])).toMatchObject({ skipped: "in_house" });
  expect(f.writes).toEqual([]); expect(f.sends).toEqual([]);
});
test("all Ready Check time-email callers and PIESA trigger are suppressed before logging", async () => {
  const f = fixture();
  const ready = f.load("ready-check-times.server", "\nexport const testTellOwner = tellOwner;");
  await ready.testTellOwner("j", ["2026-11-04T00:00:00Z"]);
  expect(await f.load("owner-email-triggers.server").onSafetyCheckTimesOffered("j", ["2026-11-04T00:00:00Z"])).toBe("in_house");
  expect(f.sends).toEqual([]); expect(f.writes).toEqual([]);
});
test("trade times reminder stops before provider reads", async () => {
  const f = fixture();
  expect(await f.load("piesa-times-reminder.server").remindTradeToOfferTimes({ jobId: "j", assignmentId: "asg", visitKind: "piesa", remindedAt: "2026-10-30" })).toBe("in_house");
  expect(f.writes).toEqual([]); expect(f.sends).toEqual([]);
});
test("coordination sweep batches the state and records no in-house reminder", async () => {
  const f = fixture();
  expect(await f.load("allocation.server").sweepCoordination()).toEqual({ reminders: 0 });
  expect(f.calls.filter(c => c.select.includes("in_house"))).toHaveLength(1);
  expect(f.writes).toEqual([]);
});
test("state read failure logs and fails closed before automatic dispatch", async () => {
  const f = fixture(); f.failRead();
  const errors: unknown[][] = []; const original = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    expect(await f.load("auto-offer.server").autoOfferForJob("j", "ready_check", switches)).toMatchObject({ skipped: "in_house_read_failed" });
    expect(errors.length).toBeGreaterThan(0); expect(f.writes).toEqual([]);
  } finally { console.error = original; }
});
test("flag off dispatches normally when there is no assignment or booking", async () => {
  const f = fixture(); const api = f.load("auto-offer.server");
  f.data.partner_offers = [];
  f.overrides["./ready-check-times.server"] = { officePickReadyCheckInstaller: async () => { f.writes.push("partner_offers"); } };
  expect(await api.autoOfferForJob("j", "ready_check", switches)).toMatchObject({ skipped: "in_house" });
  f.setFlag(false);
  expect(await api.autoOfferForJob("j", "ready_check", switches)).toMatchObject({ step: "offer", businessId: "b" });
  expect(f.writes).toEqual(["partner_offers"]);
});