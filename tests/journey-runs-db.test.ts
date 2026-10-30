// Practice database (PGlite) proof for 0129 journey_runs. Fake data only.
import { expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { existsSync, readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import type { JourneyCtx } from "../src/lib/journey.server";
let storageDb: PGlite | undefined;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {
  from(table: string) {
    if (!storageDb) throw new Error("Practice storage database is not ready");
    return postgrestShim(storageDb, { jsonColumns: { journey_runs: ["steps"] } }).from(table);
  },
} }));
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
test("journey_runs: admin-only reads, mode check, undo", async () => {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('t.uid', true),'')::uuid $$;
    CREATE TABLE user_roles (user_id uuid, role text); GRANT SELECT ON user_roles TO authenticated;
    CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT exists(SELECT 1 FROM user_roles WHERE user_id=u AND role=r) $$;
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  await db.exec(read("0129_journey_runs.sql"));
  await db.exec(`INSERT INTO journey_runs (mode, passed) VALUES ('server', true);
    INSERT INTO user_roles VALUES ('00000000-0000-0000-0000-00000000000a','admin');`);
  await expect(db.exec(`INSERT INTO journey_runs (mode) VALUES ('other')`)).rejects.toThrow();
  const as = async (uid: string) => { await db.exec(`SET ROLE authenticated; SELECT set_config('t.uid','${uid}',false);`); const r = await db.query(`SELECT count(*)::int n FROM journey_runs`); await db.exec(`RESET ROLE`); return (r.rows[0] as { n: number }).n; };
  expect(await as("00000000-0000-0000-0000-00000000000a")).toBe(1);
  expect(await as("00000000-0000-0000-0000-00000000000b")).toBe(0);
  await db.exec(`SET ROLE authenticated`); await expect(db.exec(`INSERT INTO journey_runs (mode) VALUES ('server')`)).rejects.toThrow(); await db.exec(`RESET ROLE`);
  await db.exec(read("0129_journey_runs.rollback.sql"));
  expect((await db.query(`SELECT to_regclass('public.journey_runs') r`)).rows[0]).toEqual({ r: null });
});

async function pathDb() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION public.has_role(u uuid, r text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
  await db.exec(read("0129_journey_runs.sql"));
  const migration = new URL("../docs/pending-migrations/0178_journey_runs_path.sql", import.meta.url);
  if (existsSync(migration)) await db.exec(readFileSync(migration, "utf8"));
  return db;
}

test("stores path, run_group and status", async () => {
  const db = await pathDb();
  storageDb = db;
  try {
    const { storeJourneyRun } = await import("../src/lib/journey.server");
    const ctx: JourneyCtx = {
      runId: crypto.randomUUID(), startedAt: new Date().toISOString(), actorId: crypto.randomUUID(),
      jobId: null, jobNumber: null, token: null, ownerEmail: "qa.owner@hivic-test.example",
      installer: { id: crypto.randomUUID(), business_id: crypto.randomUUID() },
      electrician: { id: crypto.randomUUID(), business_id: crypto.randomUUID() },
      worker: null, calculatorInterestId: null, quoteId: null, notes: {}, screens: [],
    };
    const runGroup = crypto.randomUUID();
    const id = await storeJourneyRun("server", ctx, { passed: false, failingStep: "install window", failingReason: "blocked", steps: [] },
      { path: "p5-install-window", runGroup, status: "blocked" });
    const row = await db.query("SELECT path, run_group, status FROM journey_runs WHERE id = $1", [id]);
    expect(row.rows).toEqual([{ path: "p5-install-window", run_group: runGroup, status: "blocked" }]);
  } finally { storageDb = undefined; await db.close(); }
});

test("status rejects 'unknown'", async () => {
  const db = await pathDb();
  try {
    await expect(db.exec("INSERT INTO journey_runs (mode, status) VALUES ('server', 'unknown')"))
      .rejects.toMatchObject({ code: "23514", constraint: "journey_runs_status_check" });
  } finally { await db.close(); }
});

test("existing rows with null path still read", async () => {
  const db = await pathDb();
  try {
    await db.exec("INSERT INTO journey_runs (mode, passed) VALUES ('browser', true)");
    const row = await db.query("SELECT mode, passed, path, run_group, status FROM journey_runs");
    expect(row.rows).toEqual([{ mode: "browser", passed: true, path: null, run_group: null, status: null }]);
  } finally { await db.close(); }
});
