// Installer portal roles (new job flow, part 5, task 1) proven on a practice Postgres (PGlite), never the live database:
// Office members, the "Can see Money" switch, and one Team function for office / lead / crew / electrician.
import { afterAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
  create role anon; create role authenticated; create role service_role;
  -- As on Supabase: every new function in public is executable by these roles unless the migration revokes it.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
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
const MIGRATION = readFileSync("docs/pending-migrations/installer-portal-roles.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/installer-portal-roles.rollback.sql", "utf8");
await db.exec(MIGRATION);
afterAll(async () => { await db.close(); });

const BIZ = "00000000-0000-4000-8000-0000000000b1";
const BOSS = "00000000-0000-4000-8000-0000000000a1";
const OFFICE = "00000000-0000-4000-8000-0000000000a2";
await db.exec(`insert into public.business_members(business_id, user_id, member_role) values ('${BIZ}', '${BOSS}', 'business_admin')`);

const add = (actor: string, role: string, o: { mobile?: string | null; dob?: string | null; licence?: string | null; rec?: string | null } = {}) =>
  db.query<{ id: string }>("select public.add_team_person_with_identity($1, $2, $3, $4, $5, $6, $7, $8, $9) as id",
    [BIZ, actor, "Mia Office", role, "mobile" in o ? o.mobile : "0412345678", "mia@example.com", "dob" in o ? o.dob : "1990-04-02", o.licence ?? null, o.rec ?? null]);

describe("installer portal roles SQL", () => {
  test("office member row is accepted and money is off by default", async () => {
    await db.exec(`insert into public.business_members(business_id, user_id, member_role) values ('${BIZ}', '${OFFICE}', 'office')`);
    const r = await db.query<{ v: boolean }>(`select can_see_money v from public.business_members where user_id = '${OFFICE}'`);
    expect(r.rows[0]!.v).toBe(false);
  });

  test("add_team_person_with_identity: office without licence or qualification", async () => {
    const id = (await add(BOSS, "office")).rows[0]!.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const w = await db.query<{ trade_role: string }>("select trade_role::text from public.partner_workers where id = $1", [id]);
    expect(w.rows[0]!.trade_role).toBe("office");
    const i = await db.query<{ d: string }>("select date_of_birth::text d from public.partner_worker_identity where worker_id = $1", [id]);
    expect(i.rows[0]!.d).toBe("1990-04-02");
  });

  test("lead, crew and electrician are stored with their old shapes", async () => {
    const lead = (await add(BOSS, "lead")).rows[0]!.id;
    const l = await db.query<{ trade_role: string; worker_role: string }>("select trade_role::text, worker_role from public.partner_workers where id = $1", [lead]);
    expect(l.rows[0]).toEqual({ trade_role: "installer", worker_role: "lead" });
    const el = (await add(BOSS, "electrician", { licence: "L123", rec: "R456" })).rows[0]!.id;
    const e = await db.query<{ trade_role: string; licence_number: string; rec_number: string }>("select trade_role::text, licence_number, rec_number from public.partner_workers where id = $1", [el]);
    expect(e.rows[0]).toEqual({ trade_role: "electrician", licence_number: "L123", rec_number: "R456" });
  });

  test("mobile and date of birth are required for every role", async () => {
    for (const role of ["office", "lead", "crew"]) {
      await expect(add(BOSS, role, { mobile: null })).rejects.toThrow(/mobile/i);
      await expect(add(BOSS, role, { dob: null })).rejects.toThrow(/Date of birth/);
    }
  });

  test("electrician needs licence and REC", async () => {
    await expect(add(BOSS, "electrician", { licence: null, rec: "R1" })).rejects.toThrow(/licence/i);
    await expect(add(BOSS, "electrician", { licence: "L1", rec: null })).rejects.toThrow(/REC/);
  });

  test("only the business admin may add or switch money", async () => {
    await expect(add(OFFICE, "crew")).rejects.toThrow(/business admin/i);
    const w = (await add(BOSS, "office")).rows[0]!.id;
    await expect(db.query("select public.set_member_can_see_money($1, $2, $3, true)", [BIZ, OFFICE, w])).rejects.toThrow(/business admin/i);
  });

  test("set_member_can_see_money writes one audit row", async () => {
    const OFFICE2 = "00000000-0000-4000-8000-0000000000a3";
    await db.exec(`insert into public.business_members(business_id, user_id, member_role) values ('${BIZ}', '${OFFICE2}', 'office')`);
    const w = (await add(BOSS, "office")).rows[0]!.id;
    await db.query("update public.partner_workers set profile_id = $1 where id = $2", [OFFICE2, w]);
    await db.query("select public.set_member_can_see_money($1, $2, $3, true)", [BIZ, BOSS, w]);
    const r = await db.query<{ v: boolean }>(`select can_see_money v from public.business_members where user_id = '${OFFICE2}'`);
    expect(r.rows[0]!.v).toBe(true);
    const ev = await db.query("select 1 from public.admin_config_events where event_type = 'member_money_access_changed'");
    expect(ev.rows).toHaveLength(1);
    // Switching to the same value again adds nothing.
    await db.query("select public.set_member_can_see_money($1, $2, $3, true)", [BIZ, BOSS, w]);
    expect((await db.query("select 1 from public.admin_config_events where event_type = 'member_money_access_changed'")).rows).toHaveLength(1);
  });

  // Fix wave I3: both RPCs are service_role only — a signed-in portal user (authenticated) or an anonymous caller cannot
  // execute them straight through PostgREST (`rpc(...)`); only the server's service key can.
  test("both RPCs are refused to anon and authenticated, allowed to service_role", async () => {
    const can = async (role: string, fn: string) => (await db.query<{ ok: boolean }>(`select has_function_privilege('${role}', '${fn}', 'EXECUTE') ok`)).rows[0]!.ok;
    for (const fn of ["public.add_team_person_with_identity(uuid,uuid,text,text,text,text,date,text,text)", "public.set_member_can_see_money(uuid,uuid,uuid,boolean)"]) {
      expect(await can("anon", fn), `anon ${fn}`).toBe(false);
      expect(await can("authenticated", fn), `authenticated ${fn}`).toBe(false);
      expect(await can("service_role", fn), `service_role ${fn}`).toBe(true);
    }
    // And the real thing: as `authenticated`, the call itself is refused.
    await db.exec("set role authenticated");
    try { await expect(db.query("select public.set_member_can_see_money($1, $2, $3, true)", [BIZ, BOSS, BOSS])).rejects.toThrow(/permission denied/i); }
    finally { await db.exec("reset role"); }
  });

  test("migration can run twice", async () => { await db.exec(MIGRATION); });

  test("rollback restores the old checks", async () => {
    await db.exec(ROLLBACK);
    await expect(db.exec(`insert into public.business_members(business_id, user_id, member_role) values ('${BIZ}', '00000000-0000-4000-8000-0000000000a9', 'office')`)).rejects.toThrow();
    await expect(db.exec(`insert into public.partner_workers(business_id, trade_role, full_legal_name) values ('${BIZ}', 'office', 'X')`)).rejects.toThrow();
  });
});
