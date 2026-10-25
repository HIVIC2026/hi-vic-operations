// Decision 393 (Jo, owner, 25 Oct 2026: "Yes, send all 54"): the one-off backlog route and server logic with an isolated
// fake database and stubbed senders — no hosted reads or writes, no delivery. Proves the right existing sender per kind,
// every refusal, the 60 cap, 400 on a bad body (nothing sent), nonce purpose 'backlog_send' and a PII-free response.
// Run alone: bun test tests/backlog-send.server.test.ts
import { beforeEach, describe, expect, mock, test } from "bun:test";

type JobFixture = {
  job: Record<string, unknown> | null; response?: Record<string, unknown> | null; optedOut?: boolean; media?: number;
  insulation?: string | null; prior?: string | null; priorQuestions?: boolean; readError?: boolean;
};
let db: Record<string, JobFixture>;
let events: { job_id: string; event_type: string; details: Record<string, unknown>; summary: string }[];
let calls: string[];
let rpcCalls: unknown[];
let rpcResult: boolean;
let senderOutcome: Record<string, { outcome: string; detail: string }>;
let throwFor: string | null;

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  rpc: async (name: string, args: unknown) => { rpcCalls.push({ name, args }); return { data: rpcResult, error: null }; },
  from(table: string) {
    const f: Record<string, unknown> = {};
    let inserted: Record<string, unknown> | null = null;
    const answer = () => {
      const id = String(f["id"] ?? f["job_id"] ?? "");
      const j = db[id];
      if (inserted) { if (table === "workflow_events") events.push(inserted as never); return { data: null, error: null }; }
      if (j?.readError && table === "jobs") return { data: null, error: { message: "boom" } };
      switch (table) {
        case "jobs": return { data: j?.job ?? null, error: null };
        case "lead_campaign_responses": return { data: j?.response ?? null, error: null };
        case "customer_email_optouts": return { data: j?.optedOut ? [{ opted_out_at: "2026-10-01T00:00:00Z" }] : [], error: null };
        case "documents": return { data: null, count: j?.media ?? 0, error: null };
        // Decision 393: f.__or = the Save my spot offer count; f.__like = the 3-questions invitation count.
        case "customer_email_sends": return { data: null, count: f["__or"] ? (j?.prior ? 1 : 0) : (j?.priorQuestions ? 1 : 0), error: null };
        case "indicative_estimates": return { data: j ? { insulation_declared: j.insulation ?? null } : null, error: null };
        case "workflow_events": return { data: events.filter((e) => e.job_id === id && e.event_type === f["event_type"]), error: null };
        default: return { data: null, error: null };
      }
    };
    const q = {
      select() { return q; }, eq(c: string, v: unknown) { f[c] = v; return q; }, not() { return q; }, in() { return q; }, or() { f["__or"] = true; return q; }, like() { f["__like"] = true; return q; }, order() { return q; }, limit() { return q; },
      insert(row: Record<string, unknown>) { inserted = row; return q; },
      maybeSingle: async () => answer(), then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) { return Promise.resolve(answer()).then(resolve, reject); },
    };
    return q;
  },
} }));
mock.module("../src/lib/initial-response-history.server", () => ({ initialResponseHistoryBlocker: async (id: string) => db[id]?.prior ?? null }));
mock.module("../src/lib/estimatelink.server", () => ({ syncStep3: async (id: string) => { calls.push(`sync:${id}`); } }));
const stub = (name: string, id: string) => {
  calls.push(`${name}:${id}`);
  if (throwFor === id) throw new Error("provider exploded for owner@example.com");
  return { jobId: id, jobNumber: null, ...(senderOutcome[id] ?? { outcome: "sent", detail: "Sent" }) };
};
const sendArgs: unknown[] = [];
mock.module("../src/lib/hot-leads-send.server", () => ({
  sendSaveMySpot: async (ids: string[], actor: unknown, opts: unknown) => { sendArgs.push({ ids, actor, opts }); return [stub("save_spot_none", ids[0]!)]; },
  sendExistingInsulationSaveSpot: async (id: string, actor: unknown, preview: unknown) => { sendArgs.push({ id, actor, preview }); return stub("save_spot_existing", id); },
  sendInsulationQuestionsInvitation: async (id: string) => stub("questions", id),
  sendAutomaticInsulationDetails: async (id: string) => stub("WRONG_auto_insulation", id),
}));

const { Route } = await import("../src/routes/api/public/hooks/backlog-send");
const { runBacklogSend } = await import("../src/lib/backlog-send.server");
const { PRESENT_AUTO_OFFER_EVENT } = await import("../src/lib/insulation-review.core");
const post = (Route as unknown as { options: { server: { handlers: { POST: (x: { request: Request }) => Promise<Response> } } } }).options.server.handlers.POST;
const NONCE = "a".repeat(64);
const call = (body: unknown, headers: Record<string, string> = { "x-hivic-cron-nonce": NONCE }) =>
  post({ request: new Request("http://x/api/public/hooks/backlog-send", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }) });

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = (n: number, patch: Record<string, unknown> = {}) => ({
  job_number: `HV-${9000 + n}`, source: "base44", stage: "lead", deleted_at: null, qa_archived_at: null, eligibility_outcome: "needs_onsite_confirmation",
  owners: { email: `owner${n}@example.com`, full_name: `Owner Number${n}` }, ...patch,
});
const open = (n: number, extra: Partial<JobFixture> = {}): JobFixture => ({ job: job(n), insulation: "present", ...extra });

beforeEach(() => {
  db = {}; events = []; calls = []; rpcCalls = []; rpcResult = true; senderOutcome = {}; throwFor = null; sendArgs.length = 0;
  process.env.LOVABLE_CRON_SECRET = "right-secret";
});

describe("right existing sender per kind", () => {
  test("save_spot_none → sendSaveMySpot([job], null, {}); save_spot_existing → qualification + existing sender; questions → 3-questions invitation", async () => {
    db[id(1)] = open(1, { insulation: "none" }); db[id(2)] = open(2); db[id(3)] = open(3);
    const res = await call({ sends: [{ jobId: id(1), kind: "save_spot_none" }, { jobId: id(2), kind: "save_spot_existing" }, { jobId: id(3), kind: "questions" }] });
    expect(res.status).toBe(200);
    expect(rpcCalls).toEqual([{ name: "consume_cron_nonce", args: { _nonce: NONCE, _purpose: "backlog_send" } }]);
    expect(calls).toEqual([`sync:${id(1)}`, `save_spot_none:${id(1)}`, `sync:${id(2)}`, `save_spot_existing:${id(2)}`, `sync:${id(3)}`, `questions:${id(3)}`]);
    expect(sendArgs).toEqual([{ ids: [id(1)], actor: null, opts: {} }, { id: id(2), actor: null, preview: false }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ job_id: id(2), event_type: PRESENT_AUTO_OFFER_EVENT, details: { answer: "yes", declaration_type: "present_auto_offer", basis: "owner_declared" } });
    const json = await res.json();
    expect(json).toEqual({ ok: true, sent: 3, skipped: 0, failed: 0, results: [
      { jobNumber: "HV-9001", kind: "save_spot_none", outcome: "sent", detail: "Sent" },
      { jobNumber: "HV-9002", kind: "save_spot_existing", outcome: "sent", detail: "Sent" },
      { jobNumber: "HV-9003", kind: "questions", outcome: "sent", detail: "Sent" },
    ] });
  });
  test("save_spot_existing: unknown estimate insulation records answer 'unknown' (decision 392); an existing record is not duplicated", async () => {
    db[id(4)] = open(4, { insulation: "unknown" });
    await runBacklogSend([{ jobId: id(4), kind: "save_spot_existing" }]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ details: { answer: "unknown", declaration_type: "unknown_auto_offer" } });
    expect(events[0]!.summary).toContain("doesn't know");
    await runBacklogSend([{ jobId: id(4), kind: "save_spot_existing" }]);
    expect(events).toHaveLength(1);
    expect(calls.filter((c) => c.startsWith("save_spot_existing"))).toHaveLength(2);
  });
  test("save_spot_existing with a no-insulation estimate is skipped before any record or send", async () => {
    db[id(5)] = open(5, { insulation: "none" });
    const [r] = await runBacklogSend([{ jobId: id(5), kind: "save_spot_existing" }]);
    expect(r).toMatchObject({ outcome: "skipped" });
    expect(events).toEqual([]);
    expect(calls.some((c) => c.startsWith("save_spot_existing"))).toBe(false);
  });
  test("the new-enquiry automatic insulation sender is never used", async () => {
    db[id(6)] = open(6);
    await runBacklogSend([{ jobId: id(6), kind: "questions" }]);
    expect(calls.some((c) => c.startsWith("WRONG"))).toBe(false);
  });
});

describe("refusals: skipped with a reason, no sync, no sender", () => {
  const T = "2026-10-01T00:00:00Z";
  const cases: [string, Partial<JobFixture>, string, "save_spot_none" | "questions"][] = [
    ["not base44", { job: job(10, { source: "manual" }) }, "Not a website enquiry", "save_spot_none"],
    ["qa_test", { job: job(10, { source: "qa_test" }) }, "TEST job", "save_spot_none"],
    ["deleted", { job: job(10, { deleted_at: T }) }, "deleted", "save_spot_none"],
    ["qa archived", { job: job(10, { qa_archived_at: T }) }, "archived", "save_spot_none"],
    ["cancelled", { job: job(10, { stage: "cancelled" }) }, "cancelled", "save_spot_none"],
    ["spot saved", { response: { spot_saved_at: T, opted_out_at: null, media_received_at: null } }, "Spot already saved", "save_spot_none"],
    ["campaign opt-out", { response: { spot_saved_at: null, opted_out_at: T, media_received_at: null } }, "opted out", "save_spot_none"],
    ["email opt-out", { optedOut: true }, "opted out", "save_spot_none"],
    ["ineligible", { job: job(10, { eligibility_outcome: "does_not_appear_eligible" }) }, "Does not appear eligible", "save_spot_none"],
    ["already offered a spot", { prior: "offered" }, "Already offered a spot", "save_spot_none"],
    ["Jo's legacy exclusion", { job: job(10, { job_number: "HV-1059" }) }, "Excluded by Jo", "save_spot_none"],
    ["questions: intake media", { media: 1 }, "photos/video", "questions"],
    ["questions: media received", { response: { spot_saved_at: null, opted_out_at: null, media_received_at: T } }, "photos/video", "questions"],
  ];
  for (const [name, patch, reason, kind] of cases) {
    test(name, async () => {
      db[id(10)] = { ...open(10), ...patch };
      const [r] = await runBacklogSend([{ jobId: id(10), kind }]);
      expect(r!.outcome).toBe("skipped");
      expect(r!.detail).toContain(reason);
      expect(calls).toEqual([]);
      expect(events).toEqual([]);
    });
  }
  test("a home with media still gets a Save my spot kind (only questions is refused)", async () => {
    db[id(11)] = open(11, { media: 3 });
    const [r] = await runBacklogSend([{ jobId: id(11), kind: "save_spot_none" }]);
    expect(r!.outcome).toBe("sent");
  });
  test("each owner gets one email: a second home on the list with the same owner email is skipped", async () => {
    db[id(12)] = open(12); db[id(13)] = { ...open(13), job: job(13, { owners: { email: " OWNER12@example.com " } }) };
    const r = await runBacklogSend([{ jobId: id(12), kind: "questions" }, { jobId: id(13), kind: "questions" }]);
    expect(r.map((x) => x.outcome)).toEqual(["sent", "skipped"]);
    expect(calls).toEqual([`sync:${id(12)}`, `questions:${id(12)}`]);
  });
  test("sender guards still decide: a blocked sender result is reported as skipped", async () => {
    db[id(14)] = open(14); senderOutcome[id(14)] = { outcome: "blocked", detail: "Customer emails are switched off — Group B invitation not sent." };
    const [r] = await runBacklogSend([{ jobId: id(14), kind: "questions" }]);
    expect(r).toEqual({ jobNumber: "HV-9014", kind: "questions", outcome: "skipped", detail: "Customer emails are switched off — Group B invitation not sent." });
  });
  test("unreadable records or a missing job fail closed; per-item errors are caught and the rest continue", async () => {
    db[id(15)] = { ...open(15), readError: true }; db[id(17)] = open(17); db[id(18)] = open(18); throwFor = id(17);
    senderOutcome[id(18)] = { outcome: "uncertain", detail: "Outcome unknown" };
    const r = await runBacklogSend([{ jobId: id(15), kind: "questions" }, { jobId: id(16), kind: "questions" }, { jobId: id(17), kind: "questions" }, { jobId: id(18), kind: "questions" }]);
    expect(r.map((x) => x.outcome)).toEqual(["failed", "failed", "failed", "uncertain"]);
    expect(r[2]!.detail).toContain("[email]");
    expect(r[2]!.detail).not.toContain("owner@example.com");
  });
});

describe("route: auth, body validation, cap, no PII", () => {
  test("bad nonce or refused nonce → 401, nothing read or sent; no nonce falls back to the cron secret", async () => {
    db[id(20)] = open(20);
    const body = { sends: [{ jobId: id(20), kind: "questions" }] };
    expect((await call(body, { "x-hivic-cron-nonce": "bad" })).status).toBe(401);
    rpcResult = false;
    expect((await call(body)).status).toBe(401);
    expect((await call(body, {})).status).toBe(401);
    expect((await call(body, { authorization: "Bearer wrong" })).status).toBe(401);
    expect(calls).toEqual([]);
    expect((await call(body, { authorization: "Bearer right-secret" })).status).toBe(200);
    expect(calls).toEqual([`sync:${id(20)}`, `questions:${id(20)}`]);
  });
  test("bad bodies → 400 and nothing is sent", async () => {
    db[id(21)] = open(21);
    const many = Array.from({ length: 61 }, (_, i) => ({ jobId: id(100 + i), kind: "questions" }));
    for (const bad of ["not json", {}, { sends: [] }, { sends: many }, { sends: [{ jobId: id(21), kind: "nope" }] }, { sends: [{ jobId: "HV-9021", kind: "questions" }] },
      { sends: [{ jobId: id(21), kind: "questions" }, { jobId: id(21), kind: "save_spot_none" }] }, { sends: [{ jobId: id(21), kind: "questions" }], extra: 1 }]) {
      const r = await call(bad);
      expect(r.status).toBe(400);
      expect((await r.json()).ok).toBe(false);
    }
    expect(calls).toEqual([]);
    expect((await (await call({ sends: many })).json()).error).toContain("60");
  });
  test("60 items are accepted and run one at a time", async () => {
    const sends = Array.from({ length: 60 }, (_, i) => { db[id(200 + i)] = open(200 + i); return { jobId: id(200 + i), kind: "questions" as const }; });
    const json = await (await call({ sends })).json();
    expect([json.sent, json.skipped, json.failed, json.results.length]).toEqual([60, 0, 0, 60]);
  });
  test("response is counts and job numbers only: no emails, names or addresses", async () => {
    db[id(30)] = { ...open(30), job: job(30, { properties: { address_line: "12 Secret St", suburb: "Hiddenvale" } }) };
    db[id(31)] = open(31); senderOutcome[id(31)] = { outcome: "failed", detail: "Resend rejected owner31@example.com (0412 345 678)" };
    const res = await call({ sends: [{ jobId: id(30), kind: "save_spot_none" }, { jobId: id(31), kind: "questions" }] });
    const text = await res.text();
    for (const pii of ["@example.com", "Owner Number", "Secret St", "Hiddenvale", "0412 345 678", id(30), id(31)]) expect(text).not.toContain(pii);
    const json = JSON.parse(text);
    expect(Object.keys(json).sort()).toEqual(["failed", "ok", "results", "sent", "skipped"]);
    for (const r of json.results) expect(Object.keys(r).sort()).toEqual(["detail", "jobNumber", "kind", "outcome"]);
  });
});
