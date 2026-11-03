// Task 11 (portal speed step 2 part A): the job page answers its sections' queries from one read of the job's rows.
// `answerFromFacts` must give exactly the database's answer, or null (the query then goes to the database as written).
// Run on its own (mock.module leaks).
import { describe, expect, mock, test } from "bun:test";
import { answerFromFacts, factsCanTry, jobFactsFrom, type Facts, type QueryOp } from "../src/lib/job-facts.core";

const J = "00000000-0000-4000-8000-000000000001", J2 = "00000000-0000-4000-8000-000000000002";
const q = (...ops: [string, ...unknown[]][]): QueryOp[] => ops.map(([m, ...a]) => ({ m, a }));
const ev = (id: string, type: string, created_at: string | null, details: unknown = null) => ({ id, job_id: J, event_type: type, created_at, details, to_stage: null });
const facts: Facts = jobFactsFrom(J, {
  id: J, stage: "installation_booked", channel: "website", deleted_at: null,
  properties: { id: "p1", suburb: "Geelong" },
  workflow_events: [
    ev("w1", "visit_allocated", "2026-10-28T01:00:00+00:00", { kind: "install", worker_id: "x" }),
    ev("w2", "visit_allocated", "2026-10-28T01:00:00.5+00:00", { kind: "install", worker_id: "y" }),
    ev("w3", "ready_check_basics", null, { completed: true, tags: ["a", "b"] }),
    ev("w4", "installer_note", "2026-10-27T23:59:59.123456+00:00", { text: "hi" }),
  ],
  bookings: [
    { id: "b1", job_id: J, kind: "installation", status: "confirmed", scheduled_start: "2026-10-30T00:00:00+00:00", businesses: { name: "Inst", trading_name: null } },
    { id: "b2", job_id: J, kind: "assessment", status: "completed", scheduled_start: null, businesses: null },
  ],
  quotes: [{ id: "q1", job_id: J, kind: "installation", status: "accepted", quote_items: [{ code: "PIESA", line_total_inc_gst: 349 }], quote_internals: { cost_ex_gst: 10 } }],
  job_assignments: { id: "a1", job_id: J, role: "installer", active: true, user_id: "u1", businesses: { in_house: false }, profiles: { full_name: "Bea" } }, // a one-to-one embed comes back as an object
});

describe("answerFromFacts: same answer as the database", () => {
  test("filters, newest first, limit and maybeSingle", () => {
    const r = answerFromFacts(facts, "workflow_events", q(["select", "event_type, details, created_at"], ["eq", "job_id", J], ["eq", "event_type", "visit_allocated"], ["order", "created_at", { ascending: false }], ["limit", 1], ["maybeSingle"]));
    expect(r).toEqual({ success: true, data: { event_type: "visit_allocated", details: { kind: "install", worker_id: "y" }, created_at: "2026-10-28T01:00:00.5+00:00" }, error: null, count: null, status: 200, statusText: "OK" });
  });
  test("nulls: last ascending, first descending (Postgres defaults), and nullsFirst when given", () => {
    const ids = (ops: QueryOp[]) => (answerFromFacts(facts, "workflow_events", ops)!.data as { id: string }[]).map((x) => x.id);
    expect(ids(q(["select", "id"], ["eq", "job_id", J], ["order", "created_at"]))).toEqual(["w4", "w1", "w2", "w3"]);
    expect(ids(q(["select", "id"], ["eq", "job_id", J], ["order", "created_at", { ascending: false }]))).toEqual(["w3", "w2", "w1", "w4"]);
    expect(ids(q(["select", "id"], ["eq", "job_id", J], ["order", "created_at", { ascending: false, nullsFirst: false }]))).toEqual(["w2", "w1", "w4", "w3"]);
  });
  test("contains (jsonb), in, is, neq, not is null, not in", () => {
    const ids = (ops: QueryOp[]) => (answerFromFacts(facts, "workflow_events", [{ m: "select", a: ["id"] }, { m: "eq", a: ["job_id", J] }, ...ops])!.data as { id: string }[]).map((x) => x.id).sort();
    expect(ids(q(["contains", "details", { completed: true }]))).toEqual(["w3"]);
    expect(ids(q(["contains", "details", { tags: ["b"] }]))).toEqual(["w3"]);
    expect(ids(q(["in", "event_type", ["installer_note", "ready_check_basics"]]))).toEqual(["w3", "w4"]);
    expect(ids(q(["is", "created_at", null]))).toEqual(["w3"]);
    expect(ids(q(["neq", "event_type", "visit_allocated"]))).toEqual(["w3", "w4"]);
    expect(ids(q(["not", "created_at", "is", null]))).toEqual(["w1", "w2", "w4"]);
    expect(ids(q(["not", "event_type", "in", "(visit_allocated,installer_note)"]))).toEqual(["w3"]);
    // NULL never passes neq / not in (SQL three-valued logic)
    expect(ids(q(["neq", "to_stage", "x"]))).toEqual([]);
  });
  test("job row by id, its property and embedded rows (array or one-to-one object) as the section selects them", () => {
    expect(answerFromFacts(facts, "jobs", q(["select", "stage, properties(suburb)"], ["eq", "id", J], ["maybeSingle"]))!.data).toEqual({ stage: "installation_booked", properties: { suburb: "Geelong" } });
    expect(answerFromFacts(facts, "quotes", q(["select", "id, quote_items(code), quote_internals(cost_ex_gst)"], ["in", "job_id", [J]]))!.data).toEqual([{ id: "q1", quote_items: [{ code: "PIESA" }], quote_internals: { cost_ex_gst: 10 } }]);
    expect(answerFromFacts(facts, "bookings", q(["select", "id, businesses(name, trading_name)"], ["eq", "job_id", J], ["eq", "kind", "installation"]))!.data).toEqual([{ id: "b1", businesses: { name: "Inst", trading_name: null } }]);
    expect(answerFromFacts(facts, "job_assignments", q(["select", "profiles:user_id(full_name)"], ["eq", "job_id", J], ["eq", "active", true]))!.data).toEqual([{ profiles: { full_name: "Bea" } }]);
  });
  test("select * returns the row's columns only: embedded rows the query did not ask for are dropped, as PostgREST does", () => {
    // I1: the facts read quotes with their items and internals; a section asking `*` must not get them (the database would not send them).
    expect(answerFromFacts(facts, "quotes", q(["select", "*"], ["eq", "job_id", J]))!.data).toEqual([{ id: "q1", job_id: J, kind: "installation", status: "accepted" }]);
    expect(answerFromFacts(facts, "quotes", q(["select", "*, quote_items(*)"], ["eq", "job_id", J]))!.data).toEqual([{ id: "q1", job_id: J, kind: "installation", status: "accepted", quote_items: [{ code: "PIESA", line_total_inc_gst: 349 }] }]);
    expect(answerFromFacts(facts, "jobs", q(["select", "*"], ["eq", "id", J], ["maybeSingle"]))!.data).toEqual({ id: J, stage: "installation_booked", channel: "website", deleted_at: null });
    expect(answerFromFacts(facts, "job_assignments", q(["select", "*"], ["eq", "job_id", J]))!.data).toEqual([{ id: "a1", job_id: J, role: "installer", active: true, user_id: "u1" }]);
  });
  test("count / head, single and range", () => {
    expect(answerFromFacts(facts, "workflow_events", q(["select", "id", { count: "exact", head: true }], ["eq", "job_id", J]))).toMatchObject({ data: null, count: 4 });
    expect(answerFromFacts(facts, "bookings", q(["select", "id"], ["eq", "job_id", J], ["eq", "kind", "assessment"], ["single"]))!.data).toEqual({ id: "b2" });
    expect((answerFromFacts(facts, "workflow_events", q(["select", "id"], ["eq", "job_id", J], ["order", "created_at"], ["range", 1, 2]))!.data as { id: string }[]).map((x) => x.id)).toEqual(["w1", "w2"]);
  });
  test("uuid order is the order of its lowercase hex (Postgres compares uuid bytes)", () => {
    const u = (n: string) => `${n}0000000-0000-4000-8000-000000000000`;
    const f = jobFactsFrom(J, { id: J, invoices: [{ id: u("b"), job_id: J }, { id: u("A"), job_id: J }, { id: u("c"), job_id: J }] });
    expect((answerFromFacts(f, "invoices", q(["select", "id"], ["eq", "job_id", J], ["order", "id"]))!.data as { id: string }[]).map((x) => x.id[0])).toEqual(["A", "b", "c"]);
  });
  test("answers are copies: changing one never changes the facts", () => {
    const a = answerFromFacts(facts, "workflow_events", q(["select", "details"], ["eq", "job_id", J], ["eq", "event_type", "installer_note"], ["maybeSingle"]))!.data as { details: { text: string } };
    a.details.text = "changed";
    expect(answerFromFacts(facts, "workflow_events", q(["select", "details"], ["eq", "job_id", J], ["eq", "event_type", "installer_note"], ["maybeSingle"]))!.data).toEqual({ details: { text: "hi" } });
  });
});

describe("answerFromFacts: anything it can't be sure of goes to the database (null)", () => {
  const no = (table: string, ...ops: [string, ...unknown[]][]) => expect(answerFromFacts(facts, table, q(...ops))).toBeNull();
  test("not scoped to this job, or scoped to another job / several jobs", () => {
    no("workflow_events", ["select", "id"], ["eq", "event_type", "installer_note"]);
    no("workflow_events", ["select", "id"], ["eq", "job_id", J2]);
    no("workflow_events", ["select", "id"], ["in", "job_id", [J, J2]]);
    no("jobs", ["select", "id"], ["in", "id", [J, J2]]);
    no("properties", ["select", "id"], ["eq", "id", "p1"]); // not a fact table
  });
  test("a column the rows don't have (missing live: the database's error), embeds it didn't read, star on a partial embed", () => {
    no("workflow_events", ["select", "no_such_column"], ["eq", "job_id", J]);
    no("workflow_events", ["select", "id"], ["eq", "job_id", J], ["eq", "no_such_column", 1]);
    no("bookings", ["select", "id, jobs!inner(stage)"], ["eq", "job_id", J]);
    no("bookings", ["select", "id, businesses(*)"], ["eq", "job_id", J]);
    no("bookings", ["select", "id, businesses(email)"], ["eq", "job_id", J]);
  });
  test("text order (collation), dates compared by eq, JSON path filters, or(), unknown methods", () => {
    no("workflow_events", ["select", "id"], ["eq", "job_id", J], ["order", "event_type"]);
    no("workflow_events", ["select", "id"], ["eq", "job_id", J], ["eq", "created_at", "2026-10-28T01:00:00+00:00"]);
    no("workflow_events", ["select", "id"], ["eq", "job_id", J], ["in", "details->>kind", ["install"]]);
    no("workflow_events", ["select", "id"], ["eq", "job_id", J], ["or", "a.eq.1,b.eq.2"]);
    no("workflow_events", ["select", "id"], ["eq", "job_id", J], ["gte", "created_at", "2026-10-01"]);
  });
  test("an ordered column holding mixed kinds (dates and numbers)", () => {
    const f = jobFactsFrom(J, { id: J, invoices: [{ id: "i1", job_id: J, x: 1 }, { id: "i2", job_id: J, x: "2026-10-01" }] });
    expect(answerFromFacts(f, "invoices", q(["select", "id"], ["eq", "job_id", J], ["order", "x"]))).toBeNull();
  });
  test("maybeSingle with several rows, single with none: the database's own error", () => {
    no("workflow_events", ["select", "id"], ["eq", "job_id", J], ["eq", "event_type", "visit_allocated"], ["maybeSingle"]);
    no("workflow_events", ["select", "id"], ["eq", "job_id", J], ["eq", "event_type", "nothing"], ["single"]);
  });
  test("factsCanTry: only queries of a shape the facts could answer wait for them", () => {
    expect(factsCanTry("workflow_events", { col: "job_id", value: J }, q(["select", "id"], ["eq", "job_id", J], ["order", "created_at"]))).toBe(true);
    expect(factsCanTry("workflow_events", { col: "job_id", value: J }, q(["select", "id"], ["in", "job_id", [J, J2]]))).toBe(false);
  });
});

describe("jobFactsClient: answers, asks once, and steps aside after a write", () => {
  test("facts answer the answerable; others go to the database once; a write stops answering", async () => {
    const sent: string[] = [];
    // A stand-in database client: records each query it is sent and answers a recognisable value.
    const base = { from: (t: string) => { const ops: string[] = []; const b: Record<string, unknown> = {}; for (const m of ["select", "eq", "in", "order", "limit", "maybeSingle", "insert"]) b[m] = (...a: unknown[]) => { ops.push(`${m}(${JSON.stringify(a)})`); return b; }; b["then"] = (ok: (v: unknown) => unknown) => { sent.push(`${t}.${ops.join(".")}`); return Promise.resolve({ data: [{ from: "db" }], error: null }).then(ok); }; return b; } };
    mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: base }));
    const { jobFactsClient } = await import("../src/lib/job-facts.server");
    let loads = 0;
    const db = jobFactsClient([{ tables: { workflow_events: { col: "job_id", value: J } }, load: async () => { loads++; return facts; } }], base as never) as unknown as { from: (t: string) => Record<string, (...a: unknown[]) => unknown> & PromiseLike<{ data: unknown }> };
    const notes = () => db.from("workflow_events").select("id").eq("job_id", J).eq("event_type", "installer_note") as unknown as PromiseLike<{ data: unknown }>;
    expect((await notes()).data).toEqual([{ id: "w4" }]);
    const other = () => db.from("partner_workers").select("id").eq("business_id", "b") as unknown as PromiseLike<{ data: unknown }>;
    const [a, b] = await Promise.all([other(), other()]);
    expect(a.data).toEqual([{ from: "db" }]);
    expect(a.data).not.toBe(b.data); // each caller gets its own copy
    expect(sent).toEqual([`partner_workers.select(["id"]).eq(["business_id","b"])`]);
    expect(loads).toBe(1);
    await (db.from("workflow_events").insert({ job_id: J }) as unknown as PromiseLike<unknown>);
    expect((await notes()).data).toEqual([{ from: "db" }]); // after a write, the database answers
  });
  test("a database function that isn't a known read stops answering from the facts", async () => {
    const base = { rpc: async () => ({ data: null, error: null }), from: () => ({ select: () => ({ eq: () => ({ then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: "db", error: null }).then(ok) }) }) }) };
    const { jobFactsClient } = await import("../src/lib/job-facts.server");
    const db = jobFactsClient([{ tables: { workflow_events: { col: "job_id", value: J } }, load: async () => facts }], base as never) as unknown as { rpc: (n: string) => Promise<unknown>; from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => PromiseLike<{ data: unknown }> } } };
    expect(((await db.from("workflow_events").select("id").eq("job_id", J)).data as unknown[]).length).toBe(4);
    await db.rpc("has_role");
    expect(((await db.from("workflow_events").select("id, event_type").eq("job_id", J)).data as unknown[]).length).toBe(4);
    await db.rpc("commit_guarded_stage");
    expect((await db.from("workflow_events").select("id, details").eq("job_id", J)).data).toBe("db");
  });
});
