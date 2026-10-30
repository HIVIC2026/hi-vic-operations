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
  let failPage = -1;
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
    let single = false; let head = false; let mutation = false; let offset = 0; let end = 999;
    const q: any = { then(resolve: (value: unknown) => unknown) {
      if (mutation) writes.push(table);
      let rows = data[table] ?? [];
      const stateRead = table === "job_assignments" && call.select.includes("in_house");
      if (stateRead) rows = data.held_assignments ?? [{ job_id: "j", business_id: "b", role: "installer", active: true, businesses: { in_house: flagged }, jobs: data.jobs?.[0] }];
      for (const [key, col, val] of call.filters) {
        if (typeof col !== "string" || (!col.includes(".") && !(col in (rows[0] ?? {})))) continue;
        const value = (r: any) => col.split(".").reduce((v, part) => v?.[part], r);
        if (key === "eq") rows = rows.filter(r => value(r) === val);
        if (key === "neq") rows = rows.filter(r => value(r) !== val);
        if (key === "in") rows = rows.filter(r => (val as unknown[]).includes(value(r)));
        if (key === "is") rows = rows.filter(r => (value(r) ?? null) === val);
      }
      if (stateRead) rows = rows.slice(offset, end + 1);
      return Promise.resolve({ data: head ? null : single ? rows[0] ?? null : rows, count: rows.length, error: stateRead && (readFailure || offset === failPage) ? { message: "state unavailable" } : null }).then(resolve);
    } };
    q.select = (s: string, opts?: { head?: boolean }) => { call.select = s; head = !!opts?.head; return q; };
    q.range = (from: number, to: number) => { offset = from; end = to; call.filters.push(["range", from, to]); return q; };
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
  return { load, data, calls, writes, sends, overrides, setFlag: (v: boolean) => { flagged = v; }, failRead: () => { readFailure = true; }, failPage: (v: number) => { failPage = v; } };
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
test("REC sweep leaves in-house offers and owner windows untouched with one state read", async () => {
  const f = fixture();
  f.data.partner_offers = [{ id: "old", job_id: "j", kind: "piesa", status: "pending" }];
  f.data.appointment_proposals = [{ id: "time", job_id: "j", status: "proposed", piesa_window_round: 1 }];
  expect(await f.load("allocation.server").sweepRecOffers()).toEqual({ expired: 0, started: 0, healed: 0 });
  expect(f.writes).toEqual([]);
  expect(f.calls.filter(c => c.select.includes("in_house"))).toHaveLength(1);
});
test("automatic sweep uses one state read across both kinds", async () => {
  const f = fixture();
  f.data.workflow_settings = [{ auto_installer_offers: true, auto_electrician_offers: true, ready_check_booking_enabled: true }];
  const result = await f.load("auto-offer.server").sweepAutoOffers();
  expect(result.offered).toBe(0); expect(f.writes).toEqual([]);
  expect(f.calls.filter(c => c.select.includes("in_house"))).toHaveLength(1);
});
test("failed reads stop PIESA start, owner times and reminder sweeps without writes", async () => {
  const f = fixture(); f.failRead();
  const original = console.error; const errors: unknown[][] = [];
  console.error = (...args) => { errors.push(args); };
  try {
    const api = f.load("allocation.server");
    expect(await api.startPiesaAllocation("j", null)).toMatchObject({ skipped: "in_house_read_failed" });
    expect(await api.submitOwnerPiesaWindows("j", "owner", [], {})).toMatchObject({ skipped: "in_house_read_failed" });
    expect(await api.sweepRecOffers()).toEqual({ expired: 0, started: 0, healed: 0 });
    expect(await api.sweepCoordination()).toEqual({ reminders: 0 });
    expect(errors).toHaveLength(4); expect(f.writes).toEqual([]);
  } finally { console.error = original; }
});
test("non-in-house Ready Check emails retain the normal path", async () => {
  const f = fixture(); f.setFlag(false);
  await f.load("ready-check-times.server", "\nexport const testTellOwner = tellOwner;").testTellOwner("j", []);
  expect(f.sends).toEqual(["ready_check"]);
});
test("TEST and deleted in-house jobs are held even when the double honours joined job filters", async () => {
  for (const job of [{ source: "qa_test", deleted_at: null }, { source: "base44", deleted_at: "2026-10-30" }]) {
    const f = fixture(); Object.assign(f.data.jobs?.[0] ?? {}, job);
    expect(await f.load("auto-offer.server").autoOfferForJob("j", "ready_check", switches)).toMatchObject({ skipped: "in_house" });
    expect(await f.load("allocation.server").startPiesaAllocation("j", null)).toMatchObject({ skipped: "in_house" });
    await f.load("ready-check-times.server", "\nexport const testTellOwner = tellOwner;").testTellOwner("j", []);
    expect(await f.load("owner-email-triggers.server").onSafetyCheckTimesOffered("j", [])).toBe("in_house");
    expect(f.writes).toEqual([]); expect(f.sends).toEqual([]);
  }
});
test("held read pages beyond 1000 assignments and keeps paging on an exact boundary", async () => {
  const f = fixture();
  f.data.held_assignments = Array.from({ length: 1200 }, (_, i) => ({ job_id: `j${i}`, business_id: "b", role: "installer", active: true, businesses: { in_house: i === 1199 } }));
  const state = await f.load("in-house-suppression.server").readInHouseDispatchState();
  expect(state.failed).toBe(false); expect(state.held.has("j1199")).toBe(true);
  expect(f.calls.filter(c => c.select.includes("in_house"))).toHaveLength(7);
});
test("failed later page logs and discards partial held results", async () => {
  const f = fixture();
  f.data.held_assignments = Array.from({ length: 201 }, (_, i) => ({ job_id: `j${i}`, business_id: "b", role: "installer", active: true, businesses: { in_house: true } }));
  f.failPage(200);
  const errors: unknown[][] = []; const original = console.error; console.error = (...args) => { errors.push(args); };
  try {
    const state = await f.load("in-house-suppression.server").readInHouseDispatchState();
    expect(state.failed).toBe(true); expect(state.held.size).toBe(0); expect(errors).toHaveLength(1);
  } finally { console.error = original; }
});
test("owner-facing skips never report success and return the exact plain message", async () => {
  for (const failed of [false, true]) {
    const f = fixture(); if (failed) f.failRead();
    const original = console.error; console.error = () => {};
    try {
      const expected = { ok: false, skipped: failed ? "in_house_read_failed" : "in_house", message: failed ? "Couldn't check the job's partner — please try again." : "Your installer will contact you directly to book this visit." };
      expect(await f.load("allocation.server").submitOwnerPiesaWindows("j", "owner", [], {})).toMatchObject(expected);
      expect(await f.load("ready-check-times.server").acceptOfferWithTimes("offer", "installer", [])).toMatchObject(expected);
      expect(f.writes).toEqual([]);
    } finally { console.error = original; }
  }
});
test("UI guard shows skipped messages before any success state", () => {
  for (const skipped of ["in_house", "in_house_read_failed"] as const) {
    const result = inHouse.inHouseSkippedAction(skipped);
    let success = false; let message = "";
    try { inHouse.assertInHouseActionSucceeded(result); success = true; } catch (e) { message = (e as Error).message; }
    expect(success).toBe(false); expect(message).toBe(result.message);
  }
  expect(() => inHouse.assertInHouseActionSucceeded({ ok: true })).not.toThrow();
});
test("scoped held lookup chunks candidate ids at 200 and reads the last chunk", async () => {
  const f = fixture();
  f.data.held_assignments = Array.from({ length: 1001 }, (_, i) => ({ job_id: `j${i}`, business_id: "b", role: "installer", active: true, businesses: { in_house: i === 1000 } }));
  const state = await f.load("in-house-suppression.server").readInHouseDispatchState(f.data.held_assignments.map(r => r.job_id));
  expect(state.held.has("j1000")).toBe(true);
  for (const call of f.calls) {
    const filter = call.filters.find(([key]) => key === "in");
    expect((filter?.[2] as unknown[]).length).toBeLessThanOrEqual(200);
  }
});
test("actual three UI callbacks stop before success/reset/refetch and show skipped messages", async () => {
  const scenarios = [
    { path: "src/routes/_authenticated/field.offer.$offerId.tsx", action: "offerTimes", catches: true },
    { path: "src/routes/my-job.$token.tsx", action: "choosePiesa", catches: false },
    { path: "src/components/portal/piesa-times.tsx", action: "choose", catches: true },
  ];
  for (const scenario of scenarios) {
    const text = readFileSync(scenario.path, "utf8");
    const source = ts.createSourceFile(scenario.path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let arrow: ts.ArrowFunction | undefined;
    function visit(node: ts.Node) {
      if (ts.isArrowFunction(node) && node.getText(source).includes(`await ${scenario.action}(`)) {
        if (!arrow || node.getText(source).length < arrow.getText(source).length) arrow = node;
      }
      ts.forEachChild(node, visit);
    }
    visit(source); if (!arrow) throw new Error(`Missing UI callback ${scenario.path}`);
    const results = [inHouse.inHouseSkippedAction("in_house"), inHouse.inHouseSkippedAction("in_house_read_failed"), ...(scenario.action === "choose" ? [{ ok: true }] : [])];
    for (const result of results) {
      const messages: string[] = []; const success: string[] = [];
      const invalidations: unknown[][] = [];
      const deps: Record<string, any> = {
        [scenario.action]: async () => result, assertInHouseActionSucceeded: inHouse.assertInHouseActionSucceeded,
        busy: false, flight: { current: false }, setBusy: () => {}, setFail: (s: string | null) => { if (s) messages.push(s); },
        refetch: async () => { success.push("refetch"); }, setPicks: () => { success.push("reset"); },
        qc: { invalidateQueries: async (...args: unknown[]) => { invalidations.push(args); success.push("refresh"); } },
        markOfficeChanged: () => { success.push("office-changed"); },
        toast: { success: () => { success.push("toast"); }, error: (s: string) => { messages.push(s); } },
        offerId: "offer", token: "token", session: "session", jobId: "j", picks: [], understands: true,
      };
      const exports: any = {};
      const code = ts.transpile(`exports.callback = ${arrow.getText(source)};`, { target: ts.ScriptTarget.ES2022 });
      new Function("exports", ...Object.keys(deps), code)(exports, ...Object.values(deps));
      if (scenario.catches) await exports.callback([]);
      else { try { await exports.callback(); } catch (e) { messages.push((e as Error).message); } }
      if ("skipped" in result) {
        expect(messages).toEqual([result.message]); expect(success).toEqual([]);
        expect(invalidations).toEqual([]);
      } else {
        expect(messages).toEqual([]);
        expect(success).toEqual(["office-changed", "toast", "reset", "refresh"]);
        expect(invalidations).toEqual([[]]);
      }
    }
  }
});
test("Reinsulate-style payee-only assignment stays unheld and owner time emails retain their normal paths", async () => {
  const f = fixture(); f.setFlag(false);
  f.data.held_assignments = [{ job_id: "j", business_id: "b", role: "installer", active: true, businesses: { in_house: false, pays_own_electricians: true } }];
  expect(inHouse.jobHeldByInHousePartner({ activeInstallerBusiness: f.data.held_assignments[0].businesses })).toBe(false);
  const state = await f.load("in-house-suppression.server").readInHouseDispatchState(["j"]);
  expect(state.failed).toBe(false); expect(state.held.size).toBe(0);
  f.data.partner_offers = [];
  f.overrides["./ready-check-times.server"] = { officePickReadyCheckInstaller: async () => { f.writes.push("partner_offers"); } };
  expect(await f.load("auto-offer.server").autoOfferForJob("j", "ready_check", switches)).toMatchObject({ step: "offer", businessId: "b" });
  await f.load("ready-check-times.server", "\nexport const testTellOwner = tellOwner;").testTellOwner("j", []);
  expect(await f.load("owner-email-triggers.server").onSafetyCheckTimesOffered("j", ["2026-11-04T00:00:00Z"])).toBe("sent");
  expect(f.sends).toEqual(["ready_check", "piesa"]);
});
test("payee-only PIESA allocation reaches the normal booked-stage healing, never the in-house skip", async () => {
  const f = fixture(); f.setFlag(false);
  f.data.held_assignments = [{ job_id: "j", business_id: "b", role: "installer", active: true, businesses: { in_house: false, pays_own_electricians: true } }];
  f.data.jobs = [{ id: "j", stage: "piesa_and_install_window_pending" }];
  f.data.bookings = [{ id: "book", job_id: "j", kind: "assessment", status: "confirmed", scheduled_start: "2026-11-04T00:00:00Z" }];
  f.data.job_assignments = [{ id: "asg", job_id: "j", role: "electrician", active: true }];
  f.overrides["./workflow.server"].transition = async () => { f.writes.push("stage"); };
  expect(await f.load("allocation.server").startPiesaAllocation("j", "office")).toEqual({ offered: 0, exhausted: false, healed: true });
  expect(f.writes).toEqual(["stage"]);
});

test("TEST sweep offers unheld jobs but still skips held TEST jobs", async () => {
  for (const held of [false,true]) {
    const f = fixture(); f.setFlag(held); f.data.jobs[0].source="qa_test"; f.data.partner_offers=[];
    f.data.workflow_settings=[{auto_installer_offers:true,auto_electrician_offers:false,ready_check_booking_enabled:true}];
    f.overrides["./ready-check-times.server"]={officePickReadyCheckInstaller:async()=>{f.writes.push("offer");}};
    expect((await f.load("auto-offer.server").sweepAutoOffers()).offered).toBe(held ? 0 : 1);
  }
});
test("flag switched off preserves assignments/booked Ready Check and normal PIESA healing", async () => {
  const f=fixture(); f.setFlag(false); f.data.partner_offers=[];
  f.data.jobs=[{id:"j",stage:"piesa_and_install_window_pending",channel:"hivic_sourced",source:"base44",deleted_at:null}];
  f.data.job_assignments=[{id:"asg",job_id:"j",role:"electrician",active:true}];
  f.data.bookings=[{id:"rc",job_id:"j",kind:"ready_check",status:"confirmed",scheduled_start:"2026-11-04T00:00:00Z"},{id:"p",job_id:"j",kind:"assessment",status:"confirmed",scheduled_start:"2026-11-05T00:00:00Z"}];
  const before=JSON.stringify({assignments:f.data.job_assignments,bookings:f.data.bookings});
  f.overrides["./workflow.server"].transition=async()=>{f.writes.push("stage");};
  expect((await f.load("auto-offer.server").autoOfferForJob("j","ready_check",switches)).step).not.toBe("offer");
  expect(await f.load("allocation.server").startPiesaAllocation("j","office")).toMatchObject({healed:true});
  expect(JSON.stringify({assignments:f.data.job_assignments,bookings:f.data.bookings})).toBe(before);
  expect(f.writes).toEqual(["stage"]);
});
