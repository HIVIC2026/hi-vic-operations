// Durable post-intake model: request path saves Step 1 + enqueues; the processor runs initial Property Intelligence
// then ONE official Gate 1 decision. Fake backend; no network, no communications. Run: bun test ./tests/
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";

type Row = Record<string, any>;
const JOB = "job-1";
const db: Record<string, Row[]> = {};
let uid = 0;
const baseJob = (extra: Row = {}) => ({ id: JOB, stage: "new_enquiry", eligibility_outcome: null, eligibility_reason: null, eligibility_decision_source: null, eligibility_decision_rules: null,
  eligibility_review_required: false, eligibility_flags: [], life_support_status: "no", estimated_area_unknown: false, estimated_area_m2: 120, next_action: null,
  properties: { address_line: "1 Test St", suburb: "Coburg", postcode: "3058", state: "VIC", occupancy: "owner_occupied", is_residential: null, year_built: null,
    enrichment: { base44: { declared: { property_type: "house", over_five_years: "yes", previous_upgrade: "no" }, raw: { answers: { insulation: "none" } } } } }, ...extra });
const reset = (job: Row = {}) => {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, { jobs: [baseJob(job)], property_facts: [], workflow_settings: [{ min_building_age_years: 5 }], bookings: [], compliance_checks: [], workflow_events: [], post_intake_work: [], property_intelligence_runs: [], owner_contact_consents: [], documents: [] });
};
function q(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let patch: Row | null = null, ins: Row | null = null;
  const rows = () => (db[table] ??= []).filter((r) => f.every((p) => p(r)));
  const exec = () => {
    if (ins) {
      if (table === "post_intake_work" && db[table]!.some((r) => r["job_id"] === ins!["job_id"] && r["work_type"] === (ins!["work_type"] ?? "initial_gate1"))) return { data: null, error: { message: "duplicate key" } };
      const r = { id: `w${++uid}`, status: "queued", attempts: 0, available_at: new Date(0).toISOString(), work_type: "initial_gate1", locked_at: null, ...ins }; db[table]!.push(r); return { data: [r], error: null };
    }
    if (patch) { const rs = rows(); rs.forEach((r) => Object.assign(r, patch)); return { data: rs, error: null }; }
    return { data: rows(), error: null };
  };
  const api: any = {
    select: () => api, order: () => api, limit: () => api, neq: () => api,
    eq: (k: string, v: unknown) => { f.push((r) => r[k] === v); return api; },
    in: (k: string, v: unknown[]) => { f.push((r) => v.includes(r[k])); return api; },
    lt: (k: string, v: string) => { f.push((r) => r[k] < v); return api; },
    single: async () => ({ data: exec().data?.[0] ?? null }), maybeSingle: async () => ({ data: exec().data?.[0] ?? null }),
    update: (p: Row) => { patch = p; return api; }, insert: (r: Row) => { ins = r; return api; },
    then: (res: any, rej: any) => Promise.resolve(exec()).then(res, rej),
  };
  return api;
}
// Emulates claim_post_intake_work: due queued/retry or expired processing -> processing with a fresh lease.
const rpc = async (_fn: string, a: { _limit: number; _lease_seconds: number; _job?: string }) => {
  const now = new Date().toISOString();
  const due = db["post_intake_work"]!.filter((w) => (!a._job || w["job_id"] === a._job) && ((["queued", "retry"].includes(w["status"]) && w["available_at"] <= now) || (w["status"] === "processing" && w["lease_expires_at"] < now))).slice(0, a._limit);
  due.forEach((w) => Object.assign(w, { status: "processing", attempts: w["attempts"] + 1, locked_at: `${now}#${++uid}`, lease_expires_at: new Date(Date.now() + a._lease_seconds * 1000).toISOString() }));
  return { data: due.map((w) => ({ ...w })), error: null };
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q, rpc } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class extends Error {}, logEvent: async (job_id: string, _a: unknown, event_type: string) => { db["workflow_events"]!.push({ job_id, event_type }); } }));
const outbound: string[] = [];
export const step3Calls: string[] = [];
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async (jobId: string) => { step3Calls.push(jobId); return { status: "issued" }; } }));
mock.module("../src/lib/esc.server", () => ({ regenerateEscNotification: async () => {} }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async (jobId: string) => { const { autoDecideEligibility } = await import("../src/lib/eligibility.server"); await autoDecideEligibility(jobId); return null; } }));
let intelMode: "ok" | "partial" | "error" = "ok";
mock.module("../src/lib/intelligence.server", () => ({
  markIntelligenceStale: async () => {},
  runPropertyIntelligence: async (jobId: string) => {
    expect(gate1Events()).toHaveLength(0); // nothing official before the initial attempt completes
    const run = { id: `r${++uid}`, job_id: jobId, status: "running", started_at: new Date().toISOString(), address_hash: "h", is_stale: false };
    db["property_intelligence_runs"]!.push(run);
    if (intelMode === "error") { run.status = "error"; db["workflow_events"]!.push({ event_type: "property_intelligence_error" }); return { status: "error" }; }
    db["property_facts"]!.push(trusted("address_verified", true), trusted("in_victoria", true));
    run.status = intelMode === "partial" ? "partial" : "complete"; db["workflow_events"]!.push({ event_type: "property_intelligence_run" });
    const { autoDecideEligibility } = await import("../src/lib/eligibility.server");
    await autoDecideEligibility(jobId); // real intelligence also calls this; must be a no-op while initial work is active
    return { status: run.status };
  },
}));
const { autoDecideEligibility } = await import("../src/lib/eligibility.server");
const { enqueueInitialGate1, processPostIntakeWork } = await import("../src/lib/postintake.server");
const { eligibilityFactsVersion, intelligenceNeeded, planEnqueue } = await import("../src/lib/postintake.core");

const gate1Events = () => db["workflow_events"]!.filter((e) => e["event_type"] === "eligibility_auto_review" || e["event_type"] === "eligibility_auto_decided");
const trusted = (fact_key: string, value: unknown) => ({ job_id: JOB, is_current: true, is_stale: false, fact_key, value, evidence_kind: "direct", confidence: "high", source_type: "public_gis", source_name: "Vicmap" });
const input = (x: Row = {}) => ({ address_line: "1 Test St", suburb: "Coburg", postcode: "3058", state: "VIC", declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: "no", base44_answers: { insulation: "none" }, estimated_area_m2: 120, ...x });
const work = () => db["post_intake_work"]!;
const job = () => db["jobs"]![0]!;

describe("request path", () => {
  test("1+2: intake enqueues and returns without intelligence or any Gate 1 event", async () => {
    reset();
    expect(await enqueueInitialGate1(JOB, await eligibilityFactsVersion(input()), "new enquiry")).toBe("insert");
    expect(work()).toHaveLength(1); expect(work()[0]!["status"]).toBe("queued");
    expect(db["property_intelligence_runs"]).toHaveLength(0);
    expect(gate1Events()).toHaveLength(0);
    expect(job()["next_action"]).toBe("Initial eligibility checks processing");
    // Other paths (sweeps, auto-advance) cannot record a decision while initial work is active.
    expect(await autoDecideEligibility(JOB)).toBeNull(); expect(gate1Events()).toHaveLength(0);
  });
  test("request path source: enqueue + waitUntil best-effort, no inline intelligence/Gate 1", () => {
    const src = readFileSync("src/lib/enquiry.server.ts", "utf8");
    expect(src).not.toMatch(/runPropertyIntelligence|autoDecideEligibility|autoAdvanceJob/);
    expect(src.match(/enqueueInitialGate1\(/g)).toHaveLength(2);
    expect(src.match(/runAfterResponse\(\(\) => processPostIntakeWork/g)).toHaveLength(2);
    // STEP 106 added `hostname` to the per-request AsyncLocalStorage store; STEP 110/111 keeps it.
    expect(readFileSync("src/server.ts", "utf8")).toMatch(/requestContext\.run\(\{ waitUntil, hostname \}/);
  });
});

describe("processor", () => {
  test("3: success -> intelligence event, then exactly one official Gate 1 event; complete", async () => {
    reset(); intelMode = "ok";
    await enqueueInitialGate1(JOB, "v1", "new enquiry");
    const r = await processPostIntakeWork({ jobId: JOB });
    expect(r.results[0]!.status).toBe("complete");
    const types = db["workflow_events"]!.map((e) => e["event_type"]);
    expect(gate1Events()).toHaveLength(1);
    expect(types.indexOf("eligibility_auto_decided")).toBeGreaterThan(types.indexOf("property_intelligence_run"));
    expect(types).not.toContain("eligibility_auto_review");
    expect(job()["eligibility_outcome"]).toBe("likely_eligible");
    expect(work()[0]!["status"]).toBe("complete");
  });
  test.skip("RETIRED property intelligence – 4a: intelligence error -> Gate 1 still runs once afterwards (REVIEW REQUIRED), work complete", async () => {
    reset(); intelMode = "error";
    await enqueueInitialGate1(JOB, "v1", "new enquiry");
    await processPostIntakeWork({ jobId: JOB });
    expect(gate1Events().map((e) => e["event_type"])).toEqual(["eligibility_auto_review"]);
    expect(work()[0]!["status"]).toBe("complete");
  });
  test("4b: partial intelligence -> one decision after it", async () => {
    reset(); intelMode = "partial";
    await enqueueInitialGate1(JOB, "v1", "new enquiry"); await processPostIntakeWork({ jobId: JOB });
    expect(gate1Events()).toHaveLength(1);
  });
  test.skip("RETIRED property intelligence – 4c: processor crash -> retry with backoff and last_error; no decision recorded", async () => {
    reset(); intelMode = "ok";
    await enqueueInitialGate1(JOB, "v1", "new enquiry");
    db["property_intelligence_runs"]!.push({ id: "live", job_id: JOB, status: "running", started_at: new Date().toISOString(), address_hash: "h", is_stale: false });
    const r = await processPostIntakeWork({ jobId: JOB });
    expect(r.results[0]!.status).toBe("retry");
    expect(work()[0]!["last_error"]).toMatch(/already running/);
    expect(work()[0]!["available_at"] > new Date().toISOString()).toBe(true);
    expect(gate1Events()).toHaveLength(0);
  });
  test("5: duplicate webhook -> one active queue item, one decision", async () => {
    reset(); intelMode = "ok";
    const v = await eligibilityFactsVersion(input());
    await enqueueInitialGate1(JOB, v, "new enquiry"); expect(await enqueueInitialGate1(JOB, v, "retry")).toBe("none");
    expect(work()).toHaveLength(1);
    await processPostIntakeWork({ jobId: JOB }); await processPostIntakeWork({ jobId: JOB });
    expect(await enqueueInitialGate1(JOB, v, "retry after complete")).toBe("none");
    expect(gate1Events()).toHaveLength(1);
  });
  test("6: two workers cannot claim the same item", async () => {
    reset(); intelMode = "ok";
    await enqueueInitialGate1(JOB, "v1", "new enquiry");
    const [a, b] = await Promise.all([rpc("x", { _limit: 5, _lease_seconds: 180 }), rpc("x", { _limit: 5, _lease_seconds: 180 })]);
    expect(a.data.length + b.data.length).toBe(1);
    // A stale worker's completion (wrong lease) is discarded.
    const w = work()[0]!; const lease = w["locked_at"]; w["locked_at"] = "someone-else";
    await q("post_intake_work").update({ status: "complete" }).eq("id", w["id"]).eq("locked_at", lease);
    expect(w["status"]).toBe("processing");
  });
  test("7: expired processing lease is reclaimed and completed", async () => {
    reset(); intelMode = "ok";
    await enqueueInitialGate1(JOB, "v1", "new enquiry");
    Object.assign(work()[0]!, { status: "processing", attempts: 1, locked_at: "dead", lease_expires_at: new Date(Date.now() - 1000).toISOString() });
    const r = await processPostIntakeWork({ jobId: JOB });
    expect(r.results[0]!.status).toBe("complete"); expect(work()[0]!["attempts"]).toBe(2);
    expect(gate1Events()).toHaveLength(1);
  });
  test("9: admin decision is never overwritten", async () => {
    reset({ eligibility_decision_source: "admin", eligibility_outcome: "does_not_appear_eligible", next_action: "Admin note" }); intelMode = "ok";
    await enqueueInitialGate1(JOB, "v1", "new enquiry");
    expect(job()["next_action"]).toBe("Admin note");
    await processPostIntakeWork({ jobId: JOB });
    expect(job()["eligibility_outcome"]).toBe("does_not_appear_eligible"); expect(job()["eligibility_decision_source"]).toBe("admin");
    expect(gate1Events()).toHaveLength(0);
  });
});

describe("repeat sync / facts version", () => {
  test("10: unchanged intake does not requeue; consent/media/contact-only changes do not; address or eligibility answers do", async () => {
    const v = await eligibilityFactsVersion(input());
    expect(planEnqueue({ id: "w", status: "complete", facts_version: v, attempts: 1 }, v)).toBe("none");
    expect(await eligibilityFactsVersion({ ...input(), contact_consent: false, media: [{ x: 1 }], full_name: "Other", phone: "1" } as never)).toBe(v);
    expect(await eligibilityFactsVersion(input({ address_line: "2 Other St" }))).not.toBe(v);
    expect(await eligibilityFactsVersion(input({ base44_answers: { insulation: "present" } }))).not.toBe(v);
    expect(await eligibilityFactsVersion(input({ declared_previous_upgrade: "yes" }))).toBe(v); // previous upgrade is always "no" (Jo 29 Oct)
    expect(await eligibilityFactsVersion(input({ declared_over_five_years: "no" }))).not.toBe(v);
    expect(planEnqueue({ id: "w", status: "complete", facts_version: v, attempts: 1 }, "other")).toBe("requeue");
    reset(); intelMode = "ok";
    await enqueueInitialGate1(JOB, v, "new enquiry"); await processPostIntakeWork({ jobId: JOB });
    expect(await enqueueInitialGate1(JOB, "changed", "eligibility facts changed")).toBe("requeue");
    expect(work()).toHaveLength(1); expect(work()[0]!["status"]).toBe("queued"); expect(work()[0]!["attempts"]).toBe(0);
  });
  test("intelligence reruns only when needed (answer-only change reuses the fresh run)", () => {
    const fresh = { status: "complete", address_hash: "h", is_stale: false, started_at: new Date().toISOString() };
    expect(intelligenceNeeded(fresh, "h", Date.now(), 90)).toBeNull();
    expect(intelligenceNeeded(fresh, "h2", Date.now(), 90)).toBe("address changed");
    expect(intelligenceNeeded({ ...fresh, status: "error" }, "h", Date.now(), 90)).toBe("previous run failed");
    expect(intelligenceNeeded(null, "h", Date.now(), 90)).toBe("new enquiry");
  });
});

describe("Step 1 + safety", () => {
  test("11: consent/media still stored in the request path, before enqueue", () => {
    const src = readFileSync("src/lib/enquiry.server.ts", "utf8");
    expect(src).toMatch(/async function completeIntake[\s\S]*recordContactConsent\(jobId, ownerId, input\);[\s\S]*importBase44Media\(jobId, input\.media \?\? \[\]\)/);
    expect(src.indexOf("await completeIntake(job.id")).toBeLessThan(src.indexOf("enqueueInitialGate1(job.id"));
  });
  test("12: processor and worker route contain no external comms / Xero / Mitti calls", () => {
    for (const f of ["src/lib/postintake.server.ts", "src/lib/postintake.core.ts", "src/routes/api/public/hooks/post-intake.ts"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/sendMessage\(|sendEmail\(|sendSms\(|xero\.server|mitti\.server|recordCommunication\(/);
    }
    expect(readFileSync("src/routes/api/public/hooks/post-intake.ts", "utf8")).toMatch(/authenticateCronRequest\(request\)/);
    expect(outbound).toHaveLength(0);
  });
});
