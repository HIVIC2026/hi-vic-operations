// AI answers page (Jo 29 Oct 2026): office-only list of the standard answers the AI uses. Fake database, no live calls.
import { describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

let isAdmin = true;
let dbError: { code?: string; message: string } | null = null;
const writes: { op: string; table: string; values?: unknown; id?: unknown }[] = [];
const START = [{ id: "11111111-1111-4111-8111-111111111111", topic: "A", answer: "aa", active: true, sort: 4 }];
let rows: Record<string, unknown>[] = START;

function from(table: string) {
  let op = "select"; let values: unknown; let id: unknown;
  const q: Record<string, unknown> = {};
  const done = () => ({ data: dbError ? null : op === "select" ? rows : op === "update" ? rows.filter((r) => r["id"] === id).map((r) => ({ id: r["id"] })) : null, error: dbError });
  Object.assign(q, {
    select: () => q, order: () => q, limit: () => q,
    insert: (v: unknown) => { op = "insert"; values = v; return q; },
    update: (v: Record<string, unknown>) => { op = "update"; values = v; return q; },
    delete: () => { op = "delete"; return q; },
    eq: (_c: string, v: unknown) => { id = v; return q; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => { if (op !== "select" && !dbError) writes.push({ op, table, values, id }); return Promise.resolve(done()).then(res, rej); },
  });
  return q;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
mock.module("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate: (d: unknown) => unknown = (d) => d;
    const b = { middleware: () => b, inputValidator: (fn: typeof validate) => { validate = fn; return b; },
      handler: (h: (a: { data: unknown; context: unknown }) => Promise<unknown>) => async (a: { data?: unknown }) =>
        h({ data: validate(a?.data), context: { userId: "u1", supabase: { rpc: async () => ({ data: isAdmin, error: null }) } } }) };
    return b;
  },
  createMiddleware: () => ({ server: () => ({}) }),
}));
mock.module("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

const { listAiAnswers, saveAiAnswer, removeAiAnswer } = await import("../src/lib/ai-answers.functions");
const { AI_SEED_ANSWERS } = await import("../src/lib/ai-answers.core");
const call = (fn: unknown, data?: unknown) => (fn as (a: { data?: unknown }) => Promise<any>)({ data }); // eslint-disable-line @typescript-eslint/no-explicit-any
const ID = "11111111-1111-4111-8111-111111111111";

describe("AI answers page", () => {
  test("all three functions are office-only", async () => {
    isAdmin = false;
    await expect(call(listAiAnswers)).rejects.toThrow("Admin only");
    await expect(call(saveAiAnswer, { topic: "Roof", answer: "We do ceilings.", active: true })).rejects.toThrow("Admin only");
    await expect(call(removeAiAnswer, { id: ID })).rejects.toThrow("Admin only");
    isAdmin = true;
  });
  test("topic must be 2-80 and answer 2-2000 characters", async () => {
    const ok = { topic: "Roof", answer: "We do ceilings.", active: true };
    await expect(call(saveAiAnswer, { ...ok, topic: "R" })).rejects.toThrow();
    await expect(call(saveAiAnswer, { ...ok, topic: "x".repeat(81) })).rejects.toThrow();
    await expect(call(saveAiAnswer, { ...ok, answer: "y" })).rejects.toThrow();
    await expect(call(saveAiAnswer, { ...ok, answer: "y".repeat(2001) })).rejects.toThrow();
    await expect(call(removeAiAnswer, { id: "nope" })).rejects.toThrow();
  });
  test("a new answer goes last; an edit keeps its place", async () => {
    writes.length = 0;
    await call(saveAiAnswer, { topic: "Roof", answer: "We do ceilings.", active: true });
    expect(writes[0]).toMatchObject({ op: "insert", table: "ai_reply_answers", values: { topic: "Roof", sort: 5, active: true, updated_by: "u1" } });
    await call(saveAiAnswer, { id: ID, topic: "Roof", answer: "We do ceilings.", active: false });
    expect(writes[1]).toMatchObject({ op: "update", id: ID, values: { active: false, updated_by: "u1" } });
    expect(writes[1]!.values).not.toHaveProperty("sort");
    await call(removeAiAnswer, { id: ID });
    expect(writes[2]).toMatchObject({ op: "delete", id: ID });
  });
  test("list returns the saved rows when the table is there", async () => {
    expect(await call(listAiAnswers)).toEqual({ answers: rows, available: true });
  });
  test("table missing: list shows the starting answers read-only, saving says it is waiting", async () => {
    dbError = { code: "42P01", message: 'relation "ai_reply_answers" does not exist' };
    const out = await call(listAiAnswers);
    expect(out.available).toBe(false);
    expect(out.answers.map((a: { topic: string }) => a.topic)).toEqual(AI_SEED_ANSWERS.map((a) => a.topic));
    expect(out.answers.some((a: { id?: string }) => a.id)).toBe(false);
    await expect(call(saveAiAnswer, { topic: "Roof", answer: "We do ceilings.", active: true })).rejects.toThrow("Waiting for the database change");
    await expect(call(saveAiAnswer, { id: ID, topic: "Roof", answer: "We do ceilings.", active: true })).rejects.toThrow("Waiting for the database change");
    await expect(call(removeAiAnswer, { id: ID })).rejects.toThrow("Waiting for the database change");
    dbError = null;
  });
  test("the page exists, Emails links to it, and the Emails tab stays highlighted", async () => {
    expect(existsSync(new URL("../src/routes/_authenticated/admin.ai-answers.tsx", import.meta.url))).toBe(true);
    expect(readFileSync(new URL("../src/components/portal/EmailsScreen.tsx", import.meta.url), "utf8")).toContain('to="/admin/ai-answers"');
    const { sectionFor } = await import("../src/config/office-nav");
    expect(sectionFor("/admin/ai-answers")).toBe("emails");
  });
});

describe("final C1(b): an applied but empty table", () => {
  test("list shows the starting answers (available)", async () => {
    rows = [];
    const out = await call(listAiAnswers);
    expect(out.available).toBe(true);
    expect(out.answers.map((a: { topic: string; answer: string }) => ({ topic: a.topic, answer: a.answer }))).toEqual(AI_SEED_ANSWERS);
    rows = START;
  });
  test("the first save copies the starting answers in (one insert), then adds the new answer last", async () => {
    rows = []; writes.length = 0;
    await call(saveAiAnswer, { topic: "Roof", answer: "We do ceilings.", active: true });
    expect(writes).toHaveLength(2);
    const seedWrite = writes[0]!;
    expect(seedWrite.op).toBe("insert");
    const seeded = seedWrite.values as { topic: string; answer: string; active: boolean; sort: number; updated_by: string }[];
    expect(seeded.map((r) => ({ topic: r.topic, answer: r.answer }))).toEqual(AI_SEED_ANSWERS);
    expect(seeded.map((r) => r.sort)).toEqual(AI_SEED_ANSWERS.map((_, i) => i + 1));
    expect(seeded.every((r) => r.active && r.updated_by === "u1")).toBe(true);
    expect(writes[1]).toMatchObject({ op: "insert", values: { topic: "Roof" } });
    rows = START;
  });
  test("a table with rows is not seeded again", async () => {
    writes.length = 0;
    await call(saveAiAnswer, { topic: "Roof", answer: "We do ceilings.", active: true });
    expect(writes).toHaveLength(1);
  });
});

describe("final M-c: editing an answer that was removed", () => {
  test("says to refresh", async () => {
    await expect(call(saveAiAnswer, { id: "22222222-2222-4222-8222-222222222222", topic: "Roof", answer: "We do ceilings.", active: true }))
      .rejects.toThrow("That answer no longer exists — refresh the page.");
  });
});

describe("re-review: duplicate rows on the office list", () => {
  test("each rule once, the lowest sort kept", async () => {
    rows = [{ id: "a", topic: "A", answer: "one", active: true, sort: 1 }, { id: "b", topic: "A", answer: "one", active: true, sort: 1 }, { id: "c", topic: "B", answer: "two", active: true, sort: 2 }];
    const out = await call(listAiAnswers);
    expect(out.answers.map((r: { id: string }) => r.id)).toEqual(["a", "c"]);
    rows = START;
  });
});
