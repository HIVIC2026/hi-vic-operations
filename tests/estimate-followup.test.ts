// Decision 238 (Jo, 24 Oct 2026): estimate-only leads — reminders on day 2, 7 and 21 after the estimate email, then
// an automatic close a week after the day-21 email, unless the owner saved a spot, replied, opted out or the job moved.
// Pure rules first (which step is due, keys, stop conditions, close decision, the three draft emails), then the server
// sweep against an in-memory backend with every sender mocked. Run: bun test tests/estimate-followup.test.ts
import { describe, expect, mock, test } from "bun:test";
import {
  ESTIMATE_FOLLOWUP_APPROVED, ESTIMATE_FOLLOWUP_CLOSE_AFTER_DAYS, ESTIMATE_FOLLOWUP_CLOSE_REASON, ESTIMATE_FOLLOWUP_EVENT, ESTIMATE_FOLLOWUP_NOT_SENT_EVENT, ESTIMATE_FOLLOWUP_RESULT_EVENT,
  ESTIMATE_FOLLOWUP_SCHEDULE, STOP, decideEstimateFollowup, estimateFollowupCopy, estimateFollowupKey, estimateFollowupPurpose, estimateFollowupStop,
  renderEstimateFollowupEmail, type EstimateFollowupFacts, type EstimateFollowupStep,
} from "../src/lib/estimate-followup.core";
import { FOOTER_TEXT, LOGO_DATA_URI } from "../src/lib/email-kit.core";

const EMAILED = "2026-10-01T00:00:00.000Z";
const day = (n: number, extraMs = 0) => new Date(Date.parse(EMAILED) + n * 86_400_000 + extraMs).toISOString();
const facts = (patch: Partial<EstimateFollowupFacts> = {}): EstimateFollowupFacts => ({
  stage: "preliminary_estimate_ready", source: "base44", deletedAt: null, qaArchivedAt: null, estimateEmailedAt: EMAILED,
  spotSavedAt: null, optedOut: false, repliedAt: null, ownerEmail: "helen@example.com", done: [], ...patch,
});
const decide = (now: string, patch: Partial<EstimateFollowupFacts> = {}) => decideEstimateFollowup(facts(patch), now);

describe("flag and keys", () => {
  test("wording approved by Jo 24 Oct 2026 (decision 242): the flag is true; sends stay behind customer_comms_enabled", () => {
    expect(ESTIMATE_FOLLOWUP_APPROVED).toBe(false); // decision 388: paused for spot-only wording
  });
  test("schedule: day 2, 7, 21, then close 7 days after the day-21 email", () => {
    expect(ESTIMATE_FOLLOWUP_SCHEDULE).toEqual({ day_2: 2, day_7: 7, day_21: 21 });
    expect(ESTIMATE_FOLLOWUP_CLOSE_AFTER_DAYS).toBe(7);
    expect(ESTIMATE_FOLLOWUP_CLOSE_REASON).toBe("no response after estimate");
  });
  test("one key and one purpose per job + day", () => {
    expect(estimateFollowupKey("job-1", "day_2")).toBe("estimate-followup:v1:job-1:day_2");
    expect(estimateFollowupKey("job-1", "day_21")).toBe("estimate-followup:v1:job-1:day_21");
    expect(estimateFollowupKey("job-1", "day_7")).not.toBe(estimateFollowupKey("job-2", "day_7"));
    expect(estimateFollowupPurpose("day_7")).toBe("estimate_followup_day_7");
  });
});

describe("stop conditions", () => {
  test("a live estimate-only lead is followed up", () => expect(estimateFollowupStop(facts())).toBeNull());
  test("saved a spot", () => expect(estimateFollowupStop(facts({ spotSavedAt: day(1) }))).toBe(STOP.saved));
  test("replied after the estimate email", () => expect(estimateFollowupStop(facts({ repliedAt: day(1) }))).toBe(STOP.replied));
  test("an old inbound message from before the estimate email is not a reply", () => expect(estimateFollowupStop(facts({ repliedAt: day(-3) }))).toBeNull());
  test("opted out", () => expect(estimateFollowupStop(facts({ optedOut: true }))).toBe(STOP.opted_out));
  test("moved stage", () => {
    expect(estimateFollowupStop(facts({ stage: "ready_check_ready_to_schedule" }))).toBe(STOP.moved);
    expect(estimateFollowupStop(facts({ stage: "cancelled" }))).toBe(STOP.moved);
    expect(estimateFollowupStop(facts({ stage: "new_enquiry" }))).toBe(STOP.moved);
  });
  test("deleted / archived / never offered / no email", () => {
    expect(estimateFollowupStop(facts({ deletedAt: day(1) }))).toBe(STOP.deleted);
    expect(estimateFollowupStop(facts({ qaArchivedAt: day(1) }))).toBe(STOP.archived);
    expect(estimateFollowupStop(facts({ estimateEmailedAt: null }))).toBe(STOP.not_offered);
    expect(estimateFollowupStop(facts({ ownerEmail: "  " }))).toBe(STOP.no_email);
  });
});

describe("which step is due", () => {
  test("before day 2: wait until day 2", () => expect(decide(day(1, 60_000))).toEqual({ kind: "wait", until: day(2) }));
  test("day 2 reminder is due from day 2 until day 7", () => {
    expect(decide(day(2))).toEqual({ kind: "send", step: "day_2" });
    expect(decide(day(6, 86_399_000))).toEqual({ kind: "send", step: "day_2" });
  });
  test("once day 2 is recorded, wait for day 7, then send day 7", () => {
    expect(decide(day(3), { done: [{ step: "day_2", at: day(2) }] })).toEqual({ kind: "wait", until: day(7) });
    expect(decide(day(7), { done: [{ step: "day_2", at: day(2) }] })).toEqual({ kind: "send", step: "day_7" });
  });
  test("a missed reminder is never sent late: on day 9 with nothing recorded only day 7 goes", () => {
    expect(decide(day(9))).toEqual({ kind: "send", step: "day_7" });
    expect(decide(day(25))).toEqual({ kind: "send", step: "day_21" });
  });
  test("one step per tick: day 7 done, day 21 due", () => {
    expect(decide(day(21), { done: [{ step: "day_2", at: day(2) }, { step: "day_7", at: day(7) }] })).toEqual({ kind: "send", step: "day_21" });
  });
  test("close only a week after the day-21 email was actually sent", () => {
    const done = [{ step: "day_2" as const, at: day(2) }, { step: "day_7" as const, at: day(7) }, { step: "day_21" as const, at: day(22) }];
    const sent = [{ step: "day_21" as const, at: day(22) }];
    expect(decide(day(27), { done, sent })).toEqual({ kind: "wait", until: day(29) });
    expect(decide(day(29), { done, sent })).toEqual({ kind: "close" });
    expect(decide(day(60), { done, sent })).toEqual({ kind: "close" });
  });
  test("F09: a day-21 step that was recorded but not sent (not prepared / held / failed) never starts the close", () => {
    const done = [{ step: "day_2" as const, at: day(2) }, { step: "day_7" as const, at: day(7) }, { step: "day_21" as const, at: day(22) }];
    expect(decide(day(60), { done }).kind).toBe("stop");
    expect(decide(day(60), { done, sent: [{ step: "day_7", at: day(7) }] }).kind).toBe("stop");
  });
  test("a lead whose day-21 reminder never went out (wording held) is never closed by the calendar: day 21 is still due first", () => {
    expect(decide(day(40), { done: [{ step: "day_7", at: day(7) }] })).toEqual({ kind: "send", step: "day_21" });
    expect(decide(day(40))).toEqual({ kind: "send", step: "day_21" });
    expect(decide(day(400)).kind).not.toBe("close");
  });
  test("stop conditions win over the schedule", () => {
    expect(decide(day(2), { spotSavedAt: day(1) })).toEqual({ kind: "stop", reason: STOP.saved });
    expect(decide(day(40), { repliedAt: day(30), done: [{ step: "day_21", at: day(21) }] })).toEqual({ kind: "stop", reason: STOP.replied });
  });
});

const SAVE = "https://estimate.homeinsulationvictoria.com.au/estimate/tok/campaign";
const CALC = "https://estimate.homeinsulationvictoria.com.au/estimate/tok/calculator";
const render = (step: EstimateFollowupStep, patch: Record<string, unknown> = {}) => renderEstimateFollowupEmail({
  step, firstName: "Helen Smith", rebate: 1610, price: 2188, fullPrice: 3798, basis: "Based on what you told us: 137 m² ceiling, no existing insulation.",
  saveUrl: SAVE, calculatorUrl: CALC, unsubscribeUrl: "https://u/x", ...patch,
});

describe("draft emails O66 / O67 / O68 (kit design, O1 price box, Save my spot button)", () => {
  const shell = (html: string, text: string) => {
    expect(html.startsWith("<!doctype html")).toBe(true);
    expect(html).toContain(`<img src="${LOGO_DATA_URI}" width="116" alt="Home Insulation Victoria"`);
    expect(html).toContain("max-width:540px;background:#FBFCFA;border:1px solid #E4E9F5;border-radius:22px;");
    expect(html).toContain("ABN 44 671 613 979");
    expect(text).toContain(FOOTER_TEXT);
    expect(html).not.toMatch(/display:\s*flex/);
    expect(html).not.toMatch(/<script|\son[a-z]+=/i);
    expect(html).not.toMatch(/\bHI ?VIC!?(?![a-z_])/);
    // the O1 price box and the O1 button
    expect(html).toContain("You save $1,610");
    expect(html).toContain(">$2,188<");
    expect(html).toContain('text-decoration:line-through;">$3,798');
    expect(html).toContain("Based on what you told us: 137 m² ceiling, no existing insulation.");
    expect(html).toContain("Try a different ceiling size");
    expect(html).toContain("Save my free spot");
    expect(html).toContain(`href="${SAVE}"`);
    expect(text).toContain(`Save my free spot: ${SAVE}`);
    expect(text).toContain("Unsubscribe: https://u/x");
  };
  test("O66 day 2", () => {
    const m = render("day_2");
    shell(m.html, m.text);
    expect(m.subject).toBe("Helen, your $1,610 rebate spot is still open");
    expect(m.html).toContain("Save your spot, it's free");
    expect(m.text).toContain("A couple of days ago we sent your ceiling insulation estimate.");
  });
  test("O67 day 7", () => {
    const m = render("day_7");
    shell(m.html, m.text);
    expect(m.subject).toBe("Helen, still thinking about your ceiling insulation?");
    expect(m.text).toContain("It's been a week since we sent your estimate");
  });
  test("O68 day 21 says we'll close the estimate and they can come back any time", () => {
    const m = render("day_21");
    shell(m.html, m.text);
    expect(m.subject).toBe("Helen, we'll close your estimate soon");
    expect(m.text).toContain("we'll close it in a week");
    expect(m.text).toContain("You can come back any time");
    expect(m.html).toContain("Want to keep your spot? Save it now");
  });
  test("some-insulation owners get the O2 price labels; unknown names fall back to 'there'", () => {
    const m = render("day_2", { someInsulation: true, firstName: null });
    expect(m.html).toContain("Your potential VEU rebate");
    expect(m.html).toContain("Your cost if eligible");
    expect(m.subject).toBe("there, your $1,610 rebate spot is still open");
  });
  test("TEST label on test renders; copy helper gives every step a subject, intro and save line", () => {
    expect(render("day_7", { test: true }).text).toContain("TEST — only sent to Jo.");
    for (const s of ["day_2", "day_7", "day_21"] as const) {
      const c = estimateFollowupCopy(s, "Helen", "$1,610");
      expect(c.subject.length).toBeGreaterThan(10); expect(c.intro.length).toBeGreaterThan(20); expect(c.save.length).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// Server sweep against an in-memory backend
// ---------------------------------------------------------------------------
type Row = Record<string, any>;
const db: Record<string, Row[]> = {};
const calls = { test: [] as string[], guarded: [] as string[] };
let commsAllowed = true;

const matches = (row: Row, f: { op: string; col: string; val: any }) => {
  if (f.op === "eq") return row[f.col] === f.val;
  if (f.op === "in") return (f.val as any[]).includes(row[f.col]);
  if (f.op === "is") return row[f.col] == null;
  if (f.op === "contains") return Object.entries(f.val as Row).every(([k, v]) => (row[f.col] ?? {})[k] === v);
  return true;
};
function q(table: string) {
  const filters: { op: string; col: string; val: any }[] = [];
  let mode: "select" | "update" = "select", patch: Row = {}, single = false, page: [number, number] | null = null;
  const rows = () => { const all = (db[table] ?? []).filter((r) => filters.every((f) => matches(r, f))); return page ? all.slice(page[0], page[1] + 1) : all; };
  const api: any = {
    select() { return api; }, order() { return api; }, limit() { return api; },
    range(from: number, to: number) { page = [from, to]; return api; },
    eq(col: string, val: any) { filters.push({ op: "eq", col, val }); return api; },
    in(col: string, val: any[]) { filters.push({ op: "in", col, val }); return api; },
    is(col: string, val: any) { filters.push({ op: "is", col, val }); return api; },
    contains(col: string, val: Row) { filters.push({ op: "contains", col, val }); return api; },
    update(p: Row) { mode = "update"; patch = p; return api; },
    maybeSingle() { single = true; return api; },
    then(resolve: (v: any) => void) {
      let out = rows();
      if (mode === "update") { for (const r of out) Object.assign(r, patch); }
      resolve({ data: single ? out[0] ?? null : out, error: null });
    },
  };
  return api;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/workflow.server", () => ({ WorkflowError: class WorkflowError extends Error {}, logEvent: async (job_id: string, _a: unknown, event_type: string, summary: string, details: Row, opts: Row = {}) => { (db.workflow_events ??= []).push({ job_id, event_type, summary, details, created_at: NOW, from_stage: opts.from ?? null, to_stage: opts.to ?? null }); } }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => { if (!commsAllowed) throw new Error("Customer communications are switched off"); } }));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async (ctx: { label: string }, to: string, subject: string) => { calls.test.push(`${ctx.label}:${to}:${subject}`); return { status: "sent", detail: "ok" }; } }));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async (p: { jobId: string; to: string; purpose: string; key: string; build: (u: string | null) => { subject: string } }) => { calls.guarded.push(`${p.purpose}:${p.key}:${p.to}:${p.build("https://u/x").subject}`); return "sent"; } }));

let NOW = day(2, 3_600_000);
const SCEN = [{ by_access: { standard: { estimated_customer_total: 2188, applied_discount: 1610, pre_discount_total: 3798 } } }];
function seed(opts: { jobs: Row[]; sends?: Row[]; events?: Row[]; responses?: Row[]; inbound?: Row[]; optouts?: Row[]; links?: Row[]; estimates?: Row[] }) {
  for (const k of Object.keys(db)) delete db[k];
  calls.test.length = 0; calls.guarded.length = 0;
  db.jobs = opts.jobs;
  db.customer_email_sends = opts.sends ?? opts.jobs.map((j) => ({ job_id: j.id, purpose: "existing_leads_launch_v1", idempotency_key: `existing_leads_launch_v1:save_my_spot:${j.id}`, status: "sent", sent_at: EMAILED, created_at: EMAILED }));
  db.workflow_events = opts.events ?? [];
  db.lead_campaign_responses = opts.responses ?? [];
  db.job_communications = opts.inbound ?? [];
  db.customer_email_optouts = opts.optouts ?? [];
  db.customer_estimate_links = opts.links ?? opts.jobs.map((j) => ({ job_id: j.id, token: `tok-${j.id}`, purpose: "step3_estimate", status: "active", expires_at: "2027-01-01T00:00:00Z", created_at: EMAILED }));
  db.indicative_estimates = opts.estimates ?? opts.jobs.map((j) => ({ job_id: j.id, id: `est-${j.id}`, status: "current", area_m2: 137, area_source: "owner_estimate", insulation_declared: "none", scenarios: SCEN, created_at: EMAILED }));
}
const job = (id: string, patch: Row = {}): Row => ({ id, job_number: `HV-${id}`, source: "base44", stage: "preliminary_estimate_ready", deleted_at: null, qa_archived_at: null, owner_id: "o", property_id: "p", estimated_area_m2: 137, estimated_area_unknown: false, owners: { full_name: "Helen Smith", email: `${id}@example.com` }, ...patch });

describe("server sweep (mocked backend)", () => {
  test("real owner while paused (decision 388): held, nothing sent, nothing recorded", async () => {
    const { sweepEstimateFollowups } = await import("../src/lib/estimate-followup.server");
    seed({ jobs: [job("real")] });
    const r = await sweepEstimateFollowups(new Date(NOW));
    expect(r).toEqual({ checked: 1, sent: 0, held: 1, closed: 0, stopped: 0, failed: 0 });
    expect(calls.guarded.length).toBe(0);
    expect(db.workflow_events!).toEqual([]);
  });
  test("TEST job: day 2 goes through test-send once, recorded first; a second tick does nothing", async () => {
    const { sweepEstimateFollowups } = await import("../src/lib/estimate-followup.server");
    seed({ jobs: [job("t1", { source: "qa_test" })] });
    expect(await sweepEstimateFollowups(new Date(NOW))).toMatchObject({ sent: 1, held: 0 });
    expect(calls.test).toEqual(["estimate_followup:day_2:t1@example.com:Helen, your $1,610 rebate spot is still open"]);
    expect(db.workflow_events!.map((e) => [e.event_type, e.details.step])).toEqual([[ESTIMATE_FOLLOWUP_EVENT, "day_2"], [ESTIMATE_FOLLOWUP_RESULT_EVENT, "day_2"]]);
    expect(await sweepEstimateFollowups(new Date(day(3)))).toMatchObject({ sent: 0, held: 0 });
    expect(calls.test.length).toBe(1);
    expect(await sweepEstimateFollowups(new Date(day(7)))).toMatchObject({ sent: 1 });
    expect(calls.test[1]).toContain("estimate_followup:day_7");
  });
  test("saved spot, reply, opt-out or wrong email send: stopped, nothing sent", async () => {
    const { sweepEstimateFollowups } = await import("../src/lib/estimate-followup.server");
    seed({
      jobs: [job("a", { source: "qa_test" }), job("b", { source: "qa_test" }), job("c", { source: "qa_test" }), job("d", { source: "qa_test" })],
      responses: [{ job_id: "a", spot_saved_at: day(1), opted_out_at: null }, { job_id: "c", spot_saved_at: null, opted_out_at: day(1) }],
      inbound: [{ job_id: "b", created_at: day(1), received_at: null }],
      sends: [
        ...["a", "b", "c"].map((id) => ({ job_id: id, purpose: "existing_leads_launch_v1", idempotency_key: `existing_leads_launch_v1:save_my_spot:${id}`, status: "sent", sent_at: EMAILED, created_at: EMAILED })),
        { job_id: "d", purpose: "existing_leads_launch_v1", idempotency_key: "existing_leads_launch_v1:insulation_details:d", status: "sent", sent_at: EMAILED, created_at: EMAILED }, // Group B photo email ≠ an estimate offer
      ],
    });
    expect(await sweepEstimateFollowups(new Date(NOW))).toEqual({ checked: 4, sent: 0, held: 0, closed: 0, stopped: 4, failed: 0 });
    expect(calls.test).toEqual([]);
  });
  test("missing figures: one not-sent event, counted as that step, no email", async () => {
    const { sweepEstimateFollowups } = await import("../src/lib/estimate-followup.server");
    seed({ jobs: [job("nf", { source: "qa_test" })], estimates: [] });
    await sweepEstimateFollowups(new Date(NOW));
    expect(calls.test).toEqual([]);
    expect(db.workflow_events!.map((e) => [e.event_type, e.details.step])).toEqual([[ESTIMATE_FOLLOWUP_NOT_SENT_EVENT, "day_2"]]);
    await sweepEstimateFollowups(new Date(day(3)));
    expect(db.workflow_events!.length).toBe(1);
  });
  test("close: a week after the recorded day-21 email the job is cancelled with the reason, prior stage kept, one stage_changed event", async () => {
    const { sweepEstimateFollowups } = await import("../src/lib/estimate-followup.server");
    const j = job("cl", { source: "qa_test" });
    seed({ jobs: [j], events: [{ job_id: "cl", event_type: ESTIMATE_FOLLOWUP_EVENT, details: { step: "day_21" }, created_at: day(21) }, { job_id: "cl", event_type: ESTIMATE_FOLLOWUP_RESULT_EVENT, details: { step: "day_21", sent: true }, created_at: day(21) }] });
    expect(await sweepEstimateFollowups(new Date(day(27)))).toMatchObject({ closed: 0, sent: 0 });
    expect(await sweepEstimateFollowups(new Date(day(28)))).toMatchObject({ closed: 1 });
    expect(j.stage).toBe("cancelled");
    expect(j.prior_stage).toBe("preliminary_estimate_ready");
    expect(j.cancelled_reason).toBe(ESTIMATE_FOLLOWUP_CLOSE_REASON);
    const ev = db.workflow_events!.find((e) => e.event_type === "stage_changed")!;
    expect(ev.from_stage).toBe("preliminary_estimate_ready"); expect(ev.to_stage).toBe("cancelled");
    expect(ev.details).toEqual({ source: "estimate_followup", reason: ESTIMATE_FOLLOWUP_CLOSE_REASON });
    // the closed job is no longer at the estimate stage, so the next tick leaves it alone
    expect(await sweepEstimateFollowups(new Date(day(29)))).toEqual({ checked: 0, sent: 0, held: 0, closed: 0, stopped: 0, failed: 0 });
  });
  test("F09: a day-21 that was not prepared, or whose send failed, never closes the lead", async () => {
    const { sweepEstimateFollowups } = await import("../src/lib/estimate-followup.server");
    const a = job("ns", { source: "qa_test" }), b = job("fl", { source: "qa_test" });
    seed({ jobs: [a, b], events: [
      { job_id: "ns", event_type: ESTIMATE_FOLLOWUP_NOT_SENT_EVENT, details: { step: "day_21", reason: "Estimate figures missing" }, created_at: day(21) },
      { job_id: "fl", event_type: ESTIMATE_FOLLOWUP_EVENT, details: { step: "day_21" }, created_at: day(21) },
      { job_id: "fl", event_type: ESTIMATE_FOLLOWUP_RESULT_EVENT, details: { step: "day_21", sent: false, detail: "failed: bounce" }, created_at: day(21) },
    ] });
    expect(await sweepEstimateFollowups(new Date(day(40)))).toMatchObject({ closed: 0, stopped: 2 });
    expect(a.stage).toBe("preliminary_estimate_ready");
    expect(b.stage).toBe("preliminary_estimate_ready");
  });
  test("real owner when comms are off is held, not recorded (so nothing is skipped when switched on)", async () => {
    const { sendEstimateFollowupStep } = await import("../src/lib/estimate-followup.server");
    seed({ jobs: [job("r2")] });
    commsAllowed = false;
    expect(await sendEstimateFollowupStep(db.jobs![0] as any, "day_7")).toMatch(/^held/);
    commsAllowed = true;
    expect(db.workflow_events).toEqual([]);
    expect(calls.guarded).toEqual([]);
  });
});
