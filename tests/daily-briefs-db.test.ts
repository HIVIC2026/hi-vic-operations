// Practice database (PGlite) for 0101 daily briefs. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.jobs (id uuid primary key, stage text);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
INSERT INTO jobs VALUES ('20000000-0000-4000-8000-000000000001','ap_review');
`;
let db: PGlite;
beforeEach(async () => { db = new PGlite(); await db.exec(BASE); await db.exec(read("0101_daily_briefs.sql")); });

describe("0101 daily briefs (practice database)", () => {
  test("existing rows unchanged; running twice is safe", async () => {
    await db.exec(read("0101_daily_briefs.sql"));
    expect((await db.query(`SELECT stage FROM jobs`)).rows).toEqual([{ stage: "ap_review" }]);
    expect((await db.query(`SELECT count(*)::int n FROM daily_briefs`)).rows).toEqual([{ n: 0 }]);
  });
  test("only one brief per day", async () => {
    await db.exec(`INSERT INTO daily_briefs (brief_date, content) VALUES ('2026-10-05', '{}')`);
    await expect(db.exec(`INSERT INTO daily_briefs (brief_date, content) VALUES ('2026-10-05', '{}')`)).rejects.toThrow();
    await db.exec(`INSERT INTO daily_briefs (brief_date, content) VALUES ('2026-10-06', '{}')`);
    expect((await db.query(`SELECT delivery_status FROM daily_briefs ORDER BY brief_date`)).rows).toEqual([{ delivery_status: "portal_only" }, { delivery_status: "portal_only" }]);
  });
  test("unknown delivery status refused", async () => {
    await expect(db.exec(`INSERT INTO daily_briefs (brief_date, content, delivery_status) VALUES ('2026-10-05', '{}', 'emailed')`)).rejects.toThrow();
  });
  test("non-admins read nothing", async () => {
    await db.exec(`INSERT INTO daily_briefs (brief_date, content) VALUES ('2026-10-05', '{}'); GRANT USAGE ON SCHEMA public TO authenticated; SET ROLE authenticated;`);
    expect((await db.query(`SELECT count(*)::int n FROM daily_briefs`)).rows).toEqual([{ n: 0 }]);
  });
  test("undo removes only the new table", async () => {
    await db.exec(read("0101_daily_briefs.rollback.sql"));
    expect((await db.query(`SELECT to_regclass('public.daily_briefs') t`)).rows).toEqual([{ t: null }]);
    expect((await db.query(`SELECT count(*)::int n FROM jobs`)).rows).toEqual([{ n: 1 }]);
  });
});
