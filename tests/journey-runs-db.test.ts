// Practice database (PGlite) proof for 0129 journey_runs. Fake data only.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
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
