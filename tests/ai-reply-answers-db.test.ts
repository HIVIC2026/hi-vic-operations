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
const exists = (d: PGlite) => d.query<{ t: string | null }>("select to_regclass('public.ai_reply_answers')::text as t").then((r) => r.rows[0]!.t !== null);

describe("ai_reply_answers staged SQL (PGlite)", () => {
  test("applies, is idempotent, and anon/authenticated cannot read it; rollback drops it", async () => {
    const d = new PGlite();
    await d.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    await d.exec(readFileSync(SQL, "utf8"));
    await d.exec(readFileSync(SQL, "utf8"));
    await d.exec("insert into public.ai_reply_answers (topic, answer) values ('t','a')");
    const r = await d.query<{ active: boolean; sort: number }>("select active, sort from public.ai_reply_answers");
    expect(r.rows[0]).toEqual({ active: true, sort: 0 });
    for (const role of ["anon", "authenticated"]) {
      await d.exec(`set role ${role}`);
      expect(await d.query("select * from public.ai_reply_answers").then(() => "read", () => "denied")).toBe("denied");
      await d.exec("reset role");
    }
    await d.exec("set role service_role");
    expect((await d.query("select * from public.ai_reply_answers")).rows.length).toBe(1);
    await d.exec("reset role");
    await d.exec(readFileSync("docs/pending-migrations/ai-reply-answers.rollback.sql", "utf8"));
    expect(await exists(d)).toBe(false);
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
