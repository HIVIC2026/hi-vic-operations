// Staged ai_reply_answers table (PGlite proof) and loadAiAnswers (fake supabase). Own file because it mocks modules.
import { afterAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const realClient = { ...(await import("../src/integrations/supabase/client.server")) };
const world = { result: { data: [] as unknown, error: null as null | { code?: string; message: string } }, throws: false };
const q: Record<string, unknown> = {};
for (const f of ["select", "eq", "order"]) q[f] = () => q;
q["then"] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => (world.throws ? Promise.reject(new Error("boom")) : Promise.resolve(world.result)).then(res, rej);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: () => q } }));
afterAll(() => mock.module("@/integrations/supabase/client.server", () => realClient));

const SQL = "docs/pending-migrations/ai-reply-answers.sql";
const { AI_SEED_ANSWERS: AI_SEED_ANSWERS_FOR_DB } = await import("../src/lib/ai-answers.core");
const exists = (d: PGlite) => d.query<{ t: string | null }>("select to_regclass('public.ai_reply_answers')::text as t").then((r) => r.rows[0]!.t !== null);

describe("ai_reply_answers staged SQL (PGlite)", () => {
  test("applies, is idempotent, and anon/authenticated cannot read it; rollback drops it", async () => {
    const d = new PGlite();
    await d.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await d.exec(readFileSync(SQL, "utf8"));
    await d.exec(readFileSync(SQL, "utf8"));
    await d.exec("insert into public.ai_reply_answers (topic, answer) values ('t','a')");
    const r = await d.query<{ active: boolean; sort: number }>("select active, sort from public.ai_reply_answers where topic = 't'");
    expect(r.rows[0]).toEqual({ active: true, sort: 0 });
    for (const role of ["anon", "authenticated"]) {
      await d.exec(`set role ${role}`);
      expect(await d.query("select * from public.ai_reply_answers").then(() => "read", () => "denied")).toBe("denied");
      await d.exec("reset role");
    }
    await d.exec("set role service_role");
    expect((await d.query("select * from public.ai_reply_answers")).rows.length).toBe(AI_SEED_ANSWERS_FOR_DB.length + 1);
    await d.exec("reset role");
    await d.exec(readFileSync("docs/pending-migrations/ai-reply-answers.rollback.sql", "utf8"));
    expect(await exists(d)).toBe(false);
  });
});

describe("final C1(a): the staged SQL seeds Jo's starting answers", () => {
  const setup = async () => { const d = new PGlite(); await d.exec("create role anon; create role authenticated; create role service_role bypassrls;"); return d; };
  const rowsOf = (d: PGlite) => d.query<{ topic: string; answer: string; active: boolean; sort: number }>("select topic, answer, active, sort from public.ai_reply_answers order by sort");
  test("rows equal AI_SEED_ANSWERS exactly, sort 1..n, all on", async () => {
    const d = await setup();
    await d.exec(readFileSync(SQL, "utf8"));
    const r = (await rowsOf(d)).rows;
    expect(r.length).toBe(AI_SEED_ANSWERS_FOR_DB.length);
    expect(r.map((x) => ({ topic: x.topic, answer: x.answer }))).toEqual(AI_SEED_ANSWERS_FOR_DB);
    expect(r.map((x) => x.sort)).toEqual(AI_SEED_ANSWERS_FOR_DB.map((_, i) => i + 1));
    expect(r.every((x) => x.active)).toBe(true);
  });
  test("applying twice does not duplicate; a table with rows is never seeded", async () => {
    const d = await setup();
    await d.exec(readFileSync(SQL, "utf8"));
    await d.exec(readFileSync(SQL, "utf8"));
    expect((await rowsOf(d)).rows.length).toBe(AI_SEED_ANSWERS_FOR_DB.length);
    await d.exec("delete from public.ai_reply_answers; insert into public.ai_reply_answers (topic, answer) values ('Jo', 'own')");
    await d.exec(readFileSync(SQL, "utf8"));
    expect((await rowsOf(d)).rows.map((x) => x.topic)).toEqual(["Jo"]);
  });
  test("the SQL seed block is exactly what the generator writes from AI_SEED_ANSWERS (no drift)", async () => {
    const { seedBlock, SEED_START, SEED_END } = await import("../scripts/ai-reply-answers-seed-sql");
    const sql = readFileSync(SQL, "utf8");
    const a = sql.indexOf(SEED_START); const b = sql.indexOf(SEED_END);
    expect(a).toBeGreaterThan(-1);
    expect(sql.slice(a, b + SEED_END.length)).toBe(seedBlock(AI_SEED_ANSWERS_FOR_DB));
  });
});

describe("loadAiAnswers", () => {
  const reset = (o: Partial<typeof world>) => Object.assign(world, { result: { data: [], error: null }, throws: false }, o);
  test("missing table: seed, not available", async () => {
    reset({ result: { data: null, error: { code: "42P01", message: 'relation "ai_reply_answers" does not exist' } } });
    const { loadAiAnswers } = await import("../src/lib/ai-answers.server");
    const { AI_SEED_ANSWERS } = await import("../src/lib/ai-answers.core");
    expect(await loadAiAnswers()).toEqual({ answers: AI_SEED_ANSWERS, available: false });
  });
  test("other read error: seed, not available, logged", async () => {
    reset({ result: { data: null, error: { message: "network down" } } });
    const { loadAiAnswers } = await import("../src/lib/ai-answers.server");
    const { AI_SEED_ANSWERS } = await import("../src/lib/ai-answers.core");
    const spy = mock(() => undefined); const orig = console.error; console.error = spy;
    try { expect(await loadAiAnswers()).toEqual({ answers: AI_SEED_ANSWERS, available: false }); } finally { console.error = orig; }
    expect(spy).toHaveBeenCalled();
  });
  test("zero active rows: seed, available", async () => {
    reset({});
    const { loadAiAnswers } = await import("../src/lib/ai-answers.server");
    const { AI_SEED_ANSWERS } = await import("../src/lib/ai-answers.core");
    expect(await loadAiAnswers()).toEqual({ answers: AI_SEED_ANSWERS, available: true });
  });
  test("rows: the active rows in the order given", async () => {
    reset({ result: { data: [{ topic: "A", answer: "one", active: true, sort: 1 }, { topic: "B", answer: "two", active: true, sort: 2 }], error: null } });
    const { loadAiAnswers } = await import("../src/lib/ai-answers.server");
    expect(await loadAiAnswers()).toEqual({ answers: [{ topic: "A", answer: "one" }, { topic: "B", answer: "two" }], available: true });
  });
});
