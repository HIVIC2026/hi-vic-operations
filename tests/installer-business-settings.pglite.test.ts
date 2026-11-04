// Installer screens Task 9: `businesses.piesa_booked_by` (who books the safety check and the upgrades day) proven on a
// practice Postgres (PGlite), never the live database: default 'office'; anything but office/electrician/either refused;
// every change writes ONE admin_config_events `who_books_changed` row; the rollback drops the trigger (the column stays:
// it is live already through main's 2026-11-03_piesa_booked_by.sql — G6, 4 Nov 2026 — and the file applies over it).
import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
  create role anon; create role authenticated; create role service_role;
  create table public.businesses(id uuid primary key default gen_random_uuid(), name text not null, in_house boolean not null default false, branding jsonb, updated_at timestamptz not null default '2026-10-27');
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  insert into public.businesses(id, name) values ('00000000-0000-4000-8000-0000000000b1', 'Rapid Insulation');
`);
const MIGRATION = readFileSync("docs/pending-migrations/installer-business-settings.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/installer-business-settings.rollback.sql", "utf8");
const BIZ = "00000000-0000-4000-8000-0000000000b1";
const who = async () => (await db.query<{ v: string }>("select piesa_booked_by v from public.businesses where id = $1", [BIZ])).rows[0]!.v;
const events = async () => (await db.query<{ summary: string; details: Record<string, unknown> }>("select summary, details from public.admin_config_events where event_type = 'who_books_changed' order by created_at, id")).rows;
afterAll(async () => { await db.close(); });

describe("pending migration installer-business-settings.sql", () => {
  test("adds piesa_booked_by with default 'office' for the existing row; idempotent", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await who()).toBe("office");
    const added = (await db.query<{ id: string }>("insert into public.businesses(name) values ('New Co') returning id")).rows[0]!.id;
    expect((await db.query<{ v: string }>("select piesa_booked_by v from public.businesses where id = $1", [added])).rows[0]!.v).toBe("office");
    expect(await events()).toHaveLength(0); // inserts are not changes
  });
  test("only office / electrician / either are allowed", async () => {
    await expect(db.query("update public.businesses set piesa_booked_by = 'nobody' where id = $1", [BIZ])).rejects.toThrow(/piesa_booked_by/);
    await expect(db.query("update public.businesses set piesa_booked_by = null where id = $1", [BIZ])).rejects.toThrow();
    expect(await who()).toBe("office");
  });
  test("a change writes one who_books_changed row (from → to) and bumps updated_at; the same value again writes nothing", async () => {
    await db.query("update public.businesses set piesa_booked_by = 'electrician' where id = $1", [BIZ]);
    expect(await who()).toBe("electrician");
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.summary).toBe("Who books the safety check for Rapid Insulation: electrician (was office)");
    expect(ev[0]!.details).toMatchObject({ business_id: BIZ, from: "office", to: "electrician" });
    expect((await db.query<{ bumped: boolean }>("select updated_at > '2026-10-27' bumped from public.businesses where id = $1", [BIZ])).rows[0]!.bumped).toBe(true);
    await db.query("update public.businesses set piesa_booked_by = 'electrician' where id = $1", [BIZ]);
    expect(await events()).toHaveLength(1);
    await db.query("update public.businesses set piesa_booked_by = 'either' where id = $1", [BIZ]);
    expect(await events()).toHaveLength(2);
  });
  test("rollback drops the trigger and function only; the column, its check and the audit rows stay", async () => {
    await db.exec(ROLLBACK);
    expect((await db.query("select column_name from information_schema.columns where table_name = 'businesses' and column_name = 'piesa_booked_by'")).rows).toHaveLength(1);
    expect((await db.query("select conname from pg_constraint where conname = 'businesses_piesa_booked_by_check'")).rows).toHaveLength(1);
    expect((await db.query("select tgname from pg_trigger where tgname = 'trg_guard_piesa_booked_by'")).rows).toHaveLength(0);
    expect((await db.query("select proname from pg_proc where proname = 'guard_piesa_booked_by'")).rows).toHaveLength(0);
    expect(await events()).toHaveLength(2);
    await db.query("update public.businesses set piesa_booked_by = 'office' where id = $1", [BIZ]);
    expect(await events()).toHaveLength(2); // no trigger: no audit row
    await db.exec(MIGRATION); // and the trigger comes back
    expect(await who()).toBe("office");
    await db.query("update public.businesses set piesa_booked_by = 'either' where id = $1", [BIZ]);
    expect(await events()).toHaveLength(3);
  });
});

// G6 (4 Nov 2026 17:40 live check): the live database already has the column from main's 2026-11-03_piesa_booked_by.sql
// (inline check, auto-named businesses_piesa_booked_by_check). The file must apply over it unchanged — idempotent.
describe("installer-business-settings.sql over main's already-applied column (the live shape)", () => {
  test("main's column first (inline check), then this file: applies, keeps the data, adds the trigger; applying again is a no-op", async () => {
    const live = new PGlite();
    await live.exec(`
      create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
      create role anon; create role authenticated; create role service_role;
      create table public.businesses(id uuid primary key default gen_random_uuid(), name text not null, updated_at timestamptz not null default '2026-10-27');
      create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
      ALTER TABLE public.businesses ADD COLUMN piesa_booked_by text NOT NULL DEFAULT 'office' CHECK (piesa_booked_by in ('office','electrician','either'));
      insert into public.businesses(id, name, piesa_booked_by) values ('00000000-0000-4000-8000-0000000000b2', 'Live Co', 'electrician');
    `);
    expect((await live.query("select conname from pg_constraint where conname = 'businesses_piesa_booked_by_check'")).rows).toHaveLength(1); // Postgres auto-name = ours
    await live.exec(MIGRATION);
    await live.exec(MIGRATION);
    expect((await live.query<{ v: string }>("select piesa_booked_by v from public.businesses where id = '00000000-0000-4000-8000-0000000000b2'")).rows[0]!.v).toBe("electrician"); // data kept
    expect((await live.query("select conname from pg_constraint where conname = 'businesses_piesa_booked_by_check'")).rows).toHaveLength(1); // one check, not two
    expect((await live.query("select tgname from pg_trigger where tgname = 'trg_guard_piesa_booked_by'")).rows).toHaveLength(1);
    await expect(live.query("update public.businesses set piesa_booked_by = 'nobody' where id = '00000000-0000-4000-8000-0000000000b2'")).rejects.toThrow(/piesa_booked_by/);
    await live.query("update public.businesses set piesa_booked_by = 'either' where id = '00000000-0000-4000-8000-0000000000b2'");
    expect((await live.query("select 1 from public.admin_config_events where event_type = 'who_books_changed'")).rows).toHaveLength(1);
    await live.exec(ROLLBACK);
    expect((await live.query("select column_name from information_schema.columns where table_name = 'businesses' and column_name = 'piesa_booked_by'")).rows).toHaveLength(1); // main's column survives the undo
    await live.close();
  });
});
