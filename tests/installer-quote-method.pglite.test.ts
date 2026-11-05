// Photo-quote installers Task 1: `businesses.quote_method` proven on a practice Postgres (PGlite), never the live
// database: default 'ready_check'; only ready_check/photos allowed; every change writes ONE admin_config_events
// `quote_method_changed` row; re-running the file is a no-op; the rollback removes it all but keeps the audit rows.
import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
  create role anon; create role authenticated; create role service_role;
  create table public.businesses(id uuid primary key default gen_random_uuid(), name text not null, in_house boolean not null default false, updated_at timestamptz not null default '2026-10-27');
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  insert into public.businesses(id, name) values ('00000000-0000-4000-8000-0000000000b1', 'No Gap Insulation');
`);
const MIGRATION = readFileSync("drizzle/migrations/0194_installer_quote_method.sql", "utf8");
const ROLLBACK = readFileSync("docs/applied-migrations/2026-11-06_installer-quote-method.rollback.sql", "utf8");
const BIZ = "00000000-0000-4000-8000-0000000000b1";
const method = async () => (await db.query<{ v: string }>("select quote_method v from public.businesses where id = $1", [BIZ])).rows[0]!.v;
const events = async () => (await db.query<{ summary: string; details: Record<string, unknown> }>("select summary, details from public.admin_config_events where event_type = 'quote_method_changed' order by created_at, id")).rows;
afterAll(async () => { await db.close(); });

describe("pending migration installer-quote-method.sql", () => {
  test("adds quote_method with default 'ready_check'; re-running is a no-op", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await method()).toBe("ready_check");
    const added = (await db.query<{ id: string }>("insert into public.businesses(name) values ('New Co') returning id")).rows[0]!.id;
    expect((await db.query<{ v: string }>("select quote_method v from public.businesses where id = $1", [added])).rows[0]!.v).toBe("ready_check");
    expect(await events()).toHaveLength(0);
  });
  test("'photos' is accepted; 'desk' and null are refused", async () => {
    await expect(db.query("update public.businesses set quote_method = 'desk' where id = $1", [BIZ])).rejects.toThrow(/quote_method/);
    await expect(db.query("update public.businesses set quote_method = null where id = $1", [BIZ])).rejects.toThrow();
    expect(await method()).toBe("ready_check");
    await db.query("update public.businesses set quote_method = 'photos' where id = $1", [BIZ]);
    expect(await method()).toBe("photos");
  });
  test("a change wrote exactly one quote_method_changed row and bumped updated_at; the same value again writes nothing", async () => {
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.summary).toBe("How No Gap Insulation quotes: photos (was ready_check)");
    expect(ev[0]!.details).toMatchObject({ business_id: BIZ, from: "ready_check", to: "photos" });
    expect((await db.query<{ bumped: boolean }>("select updated_at > '2026-10-27' bumped from public.businesses where id = $1", [BIZ])).rows[0]!.bumped).toBe(true);
    await db.query("update public.businesses set quote_method = 'photos' where id = $1", [BIZ]);
    await db.query("update public.businesses set name = 'No Gap' where id = $1", [BIZ]);
    expect(await events()).toHaveLength(1);
    await db.exec(MIGRATION); // re-running keeps the data
    expect(await method()).toBe("photos");
    expect(await events()).toHaveLength(1);
  });
  test("rollback drops the column, check, trigger and function; audit rows stay; the file applies again", async () => {
    await db.exec(ROLLBACK);
    await db.exec(ROLLBACK);
    expect((await db.query("select column_name from information_schema.columns where table_name = 'businesses' and column_name = 'quote_method'")).rows).toHaveLength(0);
    expect((await db.query("select tgname from pg_trigger where tgname = 'trg_guard_quote_method'")).rows).toHaveLength(0);
    expect((await db.query("select proname from pg_proc where proname = 'guard_quote_method'")).rows).toHaveLength(0);
    expect(await events()).toHaveLength(1);
    await db.exec(MIGRATION);
    expect(await method()).toBe("ready_check");
  });
});
