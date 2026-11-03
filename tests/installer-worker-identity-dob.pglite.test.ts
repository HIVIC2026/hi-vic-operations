// Task 10b: the boss adds a date of birth for an EXISTING person (identity row only, never shown back), proven on a
// practice Postgres (PGlite), never the live database. Same privacy shape as the creation RPCs (0186 / installer-portal-roles).
import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
  create role anon; create role authenticated; create role service_role;
  create type public.app_role as enum ('admin','qa_office');
  create function public.has_role(_u uuid, _r public.app_role) returns boolean language sql as 'select false';
  create function public.is_admin() returns boolean language sql as 'select false';
  create type public.assignment_role as enum ('electrician','installer','property_manager');
  create table public.business_members(id uuid primary key default gen_random_uuid(), business_id uuid not null, user_id uuid not null, active boolean not null default true,
    member_role text not null default 'member' constraint business_members_member_role_check check (member_role in ('business_admin','member')), unique(business_id, user_id));
  create table public.user_roles(user_id uuid not null, role text not null);
  create table public.partner_workers(id uuid primary key default gen_random_uuid(), business_id uuid not null, profile_id uuid, trade_role public.assignment_role not null,
    full_legal_name text not null, email text, mobile text, licence_number text, rec_number text, qualification text, worker_role text, approval_status text not null default 'pending',
    declarations_due boolean not null default false, added_by uuid, certification_status text, removed_at timestamptz,
    check ((trade_role = 'electrician' and licence_number is not null) or (trade_role = 'installer' and qualification is not null) or trade_role = 'property_manager'));
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
`);
await db.exec(readFileSync("drizzle/migrations/0186_private_worker_birth_dates.sql", "utf8"));
await db.exec(readFileSync("docs/pending-migrations/installer-portal-roles.sql", "utf8"));
const MIGRATION = readFileSync("docs/pending-migrations/installer-worker-identity-dob.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/installer-worker-identity-dob.rollback.sql", "utf8");
await db.exec(MIGRATION);
afterAll(async () => { await db.close(); });

const BIZ = "00000000-0000-4000-8000-0000000000b1";
const OTHER_BIZ = "00000000-0000-4000-8000-0000000000b2";
const BOSS = "00000000-0000-4000-8000-0000000000a1";
const OFFICE = "00000000-0000-4000-8000-0000000000a2";
const OTHER_BOSS = "00000000-0000-4000-8000-0000000000a3";
const QA = "00000000-0000-4000-8000-0000000000a4";
await db.exec(`insert into public.business_members(business_id, user_id, member_role) values ('${BIZ}', '${BOSS}', 'business_admin'), ('${BIZ}', '${OFFICE}', 'office'), ('${OTHER_BIZ}', '${OTHER_BOSS}', 'business_admin'), ('${BIZ}', '${QA}', 'business_admin')`);
await db.exec(`insert into public.user_roles(user_id, role) values ('${QA}', 'qa_office')`);
// An existing person added before dates of birth were asked: no identity row.
const w = (await db.query<{ id: string }>(`insert into public.partner_workers(business_id, full_legal_name, trade_role, qualification, worker_role) values ('${BIZ}', 'Old Hand', 'installer', 'EEC CII not stated (declared, not verified)', 'lead') returning id`)).rows[0]!.id;
const setDob = (actor: string, worker: string, dob: string | null) => db.query("select public.set_worker_identity_dob($1, $2, $3)", [worker, dob, actor]);
const dobOf = async (worker: string) => (await db.query<{ d: string; by: string }>("select date_of_birth::text d, updated_by::text by from public.partner_worker_identity where worker_id = $1", [worker])).rows;
const events = async () => (await db.query<{ event_type: string; details: Record<string, unknown> }>("select event_type, details from public.admin_config_events where event_type = 'worker_identity_dob_set' order by created_at")).rows;

describe("set_worker_identity_dob (pending SQL)", () => {
  test("the worker's own business boss writes the identity row and one audit row that never holds the date", async () => {
    await setDob(BOSS, w, "1988-02-29");
    expect(await dobOf(w)).toEqual([{ d: "1988-02-29", by: BOSS }]);
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0]!.details).toEqual({ business_id: BIZ, worker_id: w, had_dob: false });
    expect(JSON.stringify(ev[0])).not.toContain("1988");
  });
  test("a second save replaces the date (one row per person) and audits that one was already on file", async () => {
    await setDob(BOSS, w, "1988-03-01");
    expect(await dobOf(w)).toEqual([{ d: "1988-03-01", by: BOSS }]);
    expect((await events()).at(-1)!.details).toMatchObject({ had_dob: true });
  });
  test("refused: office login, another business's boss, qa_office, removed person, bad date", async () => {
    await expect(setDob(OFFICE, w, "1990-01-01")).rejects.toThrow(/business admin/i);
    await expect(setDob(OTHER_BOSS, w, "1990-01-01")).rejects.toThrow(/business admin/i);
    await expect(setDob(QA, w, "1990-01-01")).rejects.toThrow(/business admin/i);
    await expect(setDob(BOSS, w, null)).rejects.toThrow(/Date of birth/);
    await expect(setDob(BOSS, w, "2999-01-01")).rejects.toThrow(/Date of birth/);
    await expect(setDob(BOSS, "00000000-0000-4000-8000-0000000000ff", "1990-01-01")).rejects.toThrow(/not found/i);
    await db.exec(`update public.partner_workers set removed_at = now() where id = '${w}'`);
    await expect(setDob(BOSS, w, "1990-01-01")).rejects.toThrow(/not found/i);
    await db.exec(`update public.partner_workers set removed_at = null where id = '${w}'`);
    expect(await dobOf(w)).toEqual([{ d: "1988-03-01", by: BOSS }]); // untouched by every refusal
    expect(await events()).toHaveLength(2);
  });
  test("service_role only: anon/authenticated cannot execute", async () => {
    const r = await db.query<{ a: boolean; s: boolean }>(
      "select has_function_privilege('authenticated', 'public.set_worker_identity_dob(uuid,date,uuid)', 'execute') a, has_function_privilege('service_role', 'public.set_worker_identity_dob(uuid,date,uuid)', 'execute') s");
    expect(r.rows[0]).toEqual({ a: false, s: true });
  });
  test("safe to run twice; rollback drops only the function", async () => {
    await db.exec(MIGRATION);
    await db.exec(ROLLBACK);
    const f = await db.query<{ n: number }>("select count(*)::int n from pg_proc where proname = 'set_worker_identity_dob'");
    expect(f.rows[0]!.n).toBe(0);
    expect(await dobOf(w)).toHaveLength(1); // identity rows and audit history stay
    await db.exec(MIGRATION);
  });
});
