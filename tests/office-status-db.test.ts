// Practice database (PGlite) proof for 0116: additive columns, snooze rules, rollback clean.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const UP = readFileSync("docs/pending-migrations/0116_office_status.sql", "utf8");
const DOWN = readFileSync("docs/pending-migrations/0116_office_status.rollback.sql", "utf8");
const JOB = "00000000-0000-4000-8000-000000000001";
const ME = "00000000-0000-4000-8000-000000000009";

async function db() {
  const d = new PGlite();
  await d.exec(`
    CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ select null::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('admin');
    CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql AS $$ select false $$;
    CREATE TABLE public.workflow_settings (id int primary key);
    CREATE TABLE public.jobs (id uuid primary key, stage text);
    INSERT INTO public.workflow_settings VALUES (1); INSERT INTO public.jobs VALUES ('${JOB}','on_hold');
  `);
  return d;
}

describe("0116 office status (practice database)", () => {
  test("adds defaults without touching existing rows", async () => {
    const d = await db(); await d.exec(UP);
    expect((await d.query<{ v: unknown }>("select office_time_limits v from workflow_settings")).rows[0]?.v).toEqual({});
    expect((await d.query<{ h: string | null; s: string }>("select hold_revisit_at h, stage s from jobs")).rows[0]).toEqual({ h: null, s: "on_hold" });
  });
  test("first snooze needs no reason; second snooze needs one", async () => {
    const d = await db(); await d.exec(UP);
    await d.exec(`insert into office_snoozes (job_id, rule_key, snoozed_until, snoozed_by) values ('${JOB}','late', now(), '${ME}')`);
    await expect(d.exec(`update office_snoozes set snooze_count = 2 where job_id='${JOB}'`)).rejects.toThrow();
    await d.exec(`update office_snoozes set snooze_count = 2, reason = 'Owner on holiday' where job_id='${JOB}'`);
    await expect(d.exec(`insert into office_snoozes (job_id, rule_key, snoozed_until, snoozed_by) values ('${JOB}','late', now(), '${ME}')`)).rejects.toThrow();
  });
  test("rollback removes everything cleanly and can re-apply", async () => {
    const d = await db(); await d.exec(UP); await d.exec(DOWN);
    expect((await d.query("select 1 from information_schema.tables where table_name='office_snoozes'")).rows.length).toBe(0);
    expect((await d.query("select 1 from information_schema.columns where column_name in ('hold_revisit_at','office_time_limits')")).rows.length).toBe(0);
    await d.exec(UP);
  });
});
