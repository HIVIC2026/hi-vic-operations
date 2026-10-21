// Brief S — F-1 regression: a completed electrician PIESA at `piesa_scheduled` must move the job to
// `piesa_complete` with the canonical Office next_action, and must NOT move on incomplete facts.
// Real requirements.server + real pure rules; the database client, the stage engine and quote derivation
// are fakes. No network, no providers, no Mitti. Run: bun test ./tests/
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { STORED_NEXT_ACTION as DEFAULT_NEXT_ACTION } from "../src/lib/workflow";
import { PIESA_COMPLETE_NEXT_ACTION, PIESA_HOLD, piesaAdvanceDecision } from "../src/lib/piesa-advance.core";

type Row = Record<string, any>;

// ---------- fake database ----------
const db: Record<string, Row[]> = {};
const resetDb = (o: { assessment?: Row | null; measurement?: Row | null; job?: Row } = {}) => {
  for (const k of Object.keys(db)) delete db[k];
  db["assessments"] = o.assessment ? [o.assessment] : [];
  db["ceiling_measurements"] = o.measurement ? [o.measurement] : [];
  db["jobs"] = [{ id: "job-1", measure_up_responsibility: "installer", next_action: "Licensed electrician to complete PIESA", ...(o.job ?? {}) }];
  // Every job carries both electrical compliance checks from creation; the run only changes their status.
  db["compliance_checks"] = [
    { job_id: "job-1", check_key: "electrical_assessment", status: "pending" },
    { job_id: "job-1", check_key: "rectification", status: "pending" },
  ];
  db["evidence_requirements"] = [{ job_id: "job-1", category: "rectification_completion", required: false, status: "not_required" }];
};

function table(name: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let patch: Row | null = null;
  const rows = () => (db[name] ??= []).filter((r) => filters.every((f) => f(r)));
  const run = () => {
    if (patch) {
      const hit = rows();
      hit.forEach((r) => Object.assign(r, patch));
      return { data: hit, error: null };
    }
    return { data: rows(), error: null };
  };
  const api: any = {
    select: () => api,
    order: () => api,
    limit: () => api,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return api; },
    maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
    single: async () => ({ data: run().data[0] ?? null, error: null }),
    update: (p: Row) => { patch = p; return api; },
    insert: (r: Row) => { (db[name] ??= []).push(r as Row); return api; },
    then: (ok: any, bad: any) => Promise.resolve(run()).then(ok, bad),
  };
  return api;
}
const admin = { from: (n: string) => table(n), rpc: async () => ({ data: null, error: null }) };

// ---------- fake stage engine ----------
class WorkflowError extends Error {}
const events: { type: string; summary: string }[] = [];
const transitions: { to: string; summary: string }[] = [];
let stage = "piesa_scheduled";
let blocker: string | null = null;
let piesa: Row | null = null;

const getStage = async () => stage;
const logEvent = async (_job: string, _actor: string | null, type: string, summary: string) => { events.push({ type, summary }); };
const piesaStatus = async () => piesa;
const transition = async (_jobId: string, to: string, _actor: string | null, summary: string) => {
  if (blocker) throw new WorkflowError(`Blocked: ${blocker}`);
  transitions.push({ to, summary });
  stage = to;
  const job = db["jobs"]![0]!;
  job["next_action"] = DEFAULT_NEXT_ACTION[to as keyof typeof DEFAULT_NEXT_ACTION];
};

let rectCount = 0;
let rectCalls = 0;
const deriveRectificationItems = async () => { rectCalls++; return rectCount; };
const generateRectificationQuote = async () => {};

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError, getStage, logEvent, piesaStatus, transition }));
mock.module("../src/lib/quotes.server", () => ({ deriveRectificationItems, generateRectificationQuote }));

const { advanceSiteRequirements } = await import("../src/lib/requirements.server");

const assessment = (o: Row = {}) => ({ id: "a-1", job_id: "job-1", status: "complete", piesa_outcome: "pass", ...o });
const currentPiesa = { piesa_date: "2026-10-15", piesa_outcome: "pass", piesa_expired: false, install_deadline: "2026-11-14" };

function setup(o: { assessment?: Row | null; piesa?: Row | null; stage?: string; blocker?: string | null; rect?: number; measurement?: Row | null } = {}) {
  resetDb({ assessment: o.assessment === undefined ? assessment() : o.assessment, measurement: o.measurement ?? null });
  stage = o.stage ?? "piesa_scheduled";
  blocker = o.blocker ?? null;
  piesa = o.piesa === undefined ? currentPiesa : o.piesa;
  rectCount = o.rect ?? 0;
  rectCalls = 0;
  events.length = 0;
  transitions.length = 0;
}

const check = (key: string) => db["compliance_checks"]!.find((c) => c["check_key"] === key);
const nextAction = () => db["jobs"]![0]!["next_action"];
const rectReq = () => db["evidence_requirements"]!.find((r) => r["category"] === "rectification_completion");

describe("F-1 pure rule", () => {
  test("only a completed assessment with a recorded outcome and a current PIESA may advance", () => {
    expect(piesaAdvanceDecision({ stage: "piesa_scheduled", assessmentStatus: "complete", outcome: "pass", hasCurrentPiesa: true }))
      .toEqual({ action: "advance", outcome: "pass" });
    expect(piesaAdvanceDecision({ stage: "piesa_scheduled", assessmentStatus: "complete", outcome: "fail", hasCurrentPiesa: true }))
      .toEqual({ action: "advance", outcome: "fail" });
    expect(piesaAdvanceDecision({ stage: "piesa_scheduled", assessmentStatus: "draft", outcome: "pending", hasCurrentPiesa: false }))
      .toEqual({ action: "hold", reason: PIESA_HOLD.notComplete });
    expect(piesaAdvanceDecision({ stage: "piesa_scheduled", assessmentStatus: "complete", outcome: "pending", hasCurrentPiesa: false }))
      .toEqual({ action: "hold", reason: PIESA_HOLD.noOutcome });
    expect(piesaAdvanceDecision({ stage: "piesa_scheduled", assessmentStatus: "complete", outcome: "pass", hasCurrentPiesa: false }))
      .toEqual({ action: "hold", reason: PIESA_HOLD.noRecord });
    expect(piesaAdvanceDecision({ stage: "installation_booked", assessmentStatus: "complete", outcome: "pass", hasCurrentPiesa: true }))
      .toEqual({ action: "hold", reason: PIESA_HOLD.wrongStage });
  });

  test("the destination's canonical next_action is the workflow default, not new wording", () => {
    expect(DEFAULT_NEXT_ACTION.piesa_complete).toBe(PIESA_COMPLETE_NEXT_ACTION);
  });
});

describe("F-1 piesa_scheduled advances on a completed result", () => {
  test("1. passing assessment with nothing to rectify → piesa_complete, both checks pass", async () => {
    setup();
    const r = await advanceSiteRequirements("job-1", "user-1");
    expect(r.advanced).toBe(true);
    expect(transitions.map((t) => t.to)).toEqual(["piesa_complete"]);
    expect(check("electrical_assessment")?.status).toBe("pass");
    expect(check("rectification")?.status).toBe("pass");
    expect(check("rectification")?.status).toBe("pass");
    expect(rectReq()).toMatchObject({ required: false, status: "not_required" });
    expect(events.filter((e) => e.type === "site_requirements_complete")).toHaveLength(1);
  });

  test("3. failed assessment still completes the PIESA and flags rectification", async () => {
    setup({ assessment: assessment({ piesa_outcome: "fail" }), piesa: { ...currentPiesa, piesa_outcome: "fail" } });
    const r = await advanceSiteRequirements("job-1", "user-1");
    expect(r.advanced).toBe(true);
    expect(transitions.map((t) => t.to)).toEqual(["piesa_complete"]);
    expect(check("electrical_assessment")?.status).toBe("pending");
    expect(rectReq()).toMatchObject({ required: true, status: "outstanding" });
    expect(check("rectification")?.status).not.toBe("pass");
  });

  test("4. passing assessment with priced rectification items → rectification still required", async () => {
    setup({ rect: 2 });
    const r = await advanceSiteRequirements("job-1", "user-1");
    expect(r.advanced).toBe(true);
    expect(rectCalls).toBe(1);
    expect(check("electrical_assessment")?.status).toBe("pending");
    expect(rectReq()).toMatchObject({ required: true, status: "outstanding" });
  });

  test("5. passing assessment, no items → no rectification requirement invented", async () => {
    setup({ rect: 0 });
    await advanceSiteRequirements("job-1", "user-1");
    expect(rectReq()).toMatchObject({ required: false, status: "not_required" });
    expect(check("rectification")?.status).toBe("pass");
  });

  test("8/9. the stage and the Office next_action both move, exactly once", async () => {
    setup();
    await advanceSiteRequirements("job-1", "user-1");
    expect(stage).toBe("piesa_complete");
    expect(nextAction()).toBe("Reconcile PIESA scope against allowance");
    expect(transitions).toHaveLength(1);
  });
});

describe("F-1 never advances on incomplete facts", () => {
  test("2. pending assessment → no transition, no rectification, no event", async () => {
    setup({ assessment: assessment({ status: "draft", piesa_outcome: "pending" }), piesa: null });
    const r: any = await advanceSiteRequirements("job-1", "user-1");
    expect(r.advanced).toBe(false);
    expect(r.held).toBe(PIESA_HOLD.notComplete);
    expect(transitions).toEqual([]);
    expect(rectCalls).toBe(0);
    expect(events).toEqual([]);
    expect(stage).toBe("piesa_scheduled");
  });

  test("6. missing mandatory evidence (no current PIESA record) → hold", async () => {
    setup({ piesa: null });
    const r: any = await advanceSiteRequirements("job-1", "user-1");
    expect(r.advanced).toBe(false);
    expect(r.held).toBe(PIESA_HOLD.noRecord);
    expect(transitions).toEqual([]);
  });

  test("10. a standing guard (e.g. unresolved hazard) keeps the job and shows why in next_action", async () => {
    setup({ blocker: "PIESA Part 7 hazard not cleared" });
    const r: any = await advanceSiteRequirements("job-1", "user-1");
    expect(r.advanced).toBe(false);
    expect(stage).toBe("piesa_scheduled");
    expect(nextAction()).toBe("PIESA Part 7 hazard not cleared");
    expect(rectCalls).toBe(0);
  });

  test("10b. a job at another stage is untouched", async () => {
    setup({ stage: "installation_booked" });
    const r = await advanceSiteRequirements("job-1", "user-1");
    expect(r.advanced).toBe(false);
    expect(transitions).toEqual([]);
  });

  test("11. running again after the move does nothing (no duplicate stage or audit events)", async () => {
    setup();
    await advanceSiteRequirements("job-1", "user-1");
    const before = { transitions: transitions.length, events: events.length, rect: rectCalls };
    await advanceSiteRequirements("job-1", "user-1");
    expect(transitions.length).toBe(before.transitions);
    expect(events.length).toBe(before.events);
    expect(rectCalls).toBe(before.rect);
  });
});

describe("F-1 preserves the existing assessment_booked behaviour", () => {
  test("7. the retired legacy branch is unchanged and still runs its rectification/quote path", async () => {
    setup({ stage: "assessment_booked", rect: 0, assessment: assessment({ piesa_outcome: "pass" }), measurement: { id: "m-1", job_id: "job-1", status: "complete", is_current: true, measured_area_m2: 117.5 } });
    const r = await advanceSiteRequirements("job-1", "user-1");
    expect(r.advanced).toBe(true);
    expect(transitions[0]!.to).toBe("assessment_complete");
    expect(transitions.at(-1)!.to).toBe("ready_for_installer_quotes");
    expect(check("rectification")?.status).toBe("pass");
  });
});

describe("F-1 has no external side effects", () => {
  test("12. the whole path is free of Mitti, Xero, messaging and HTTP", async () => {
    const calls: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (u: any) => { calls.push(String(u)); throw new Error("no network in tests"); }) as never;
    try {
      setup();
      await advanceSiteRequirements("job-1", "user-1");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toEqual([]);
    for (const f of ["src/lib/requirements.server.ts", "src/lib/piesa-advance.core.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/mitti|xero|sendMessage|twilio|realMittiCall/i);
    }
  });
});
