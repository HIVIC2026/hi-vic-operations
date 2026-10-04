// Practice database (PGlite) for 0099: owner Ready Check windows + installer one-tap booking. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const U1 = "00000000-0000-4000-8000-000000000001", U2 = "00000000-0000-4000-8000-000000000002";
const B1 = "10000000-0000-4000-8000-000000000001", B2 = "10000000-0000-4000-8000-000000000002";
const JOB = "20000000-0000-4000-8000-000000000001", PROP = "40000000-0000-4000-8000-000000000001";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE assignment_role AS ENUM ('electrician','installer','property_manager');
CREATE TYPE job_stage AS ENUM ('ready_check_ready_to_schedule','ready_check_scheduled','piesa_and_install_window_pending');
CREATE TABLE public.businesses (id uuid primary key, name text, is_active boolean default true, onboarding_status text default 'approved', coverage_verified_at timestamptz default now(), service_postcodes text[] default ARRAY['3199']);
CREATE TABLE public.business_members (business_id uuid, user_id uuid);
CREATE TABLE public.partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role assignment_role, approval_status text, removed_at timestamptz, email text);
CREATE TABLE public.partner_worker_certifications (id uuid primary key default gen_random_uuid(), worker_id uuid, worker_email text, status text, recorded_at timestamptz default now());
CREATE TABLE public.worker_certification_levels (id uuid primary key default gen_random_uuid(), certification_id uuid, level text, expires_on date, recorded_at timestamptz default now());
CREATE TABLE public.properties (id uuid primary key, postcode text);
CREATE TABLE public.jobs (id uuid primary key, property_id uuid, stage job_stage);
CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, user_id uuid, role assignment_role, business_id uuid, active boolean default true, assigned_by uuid, first_response_at timestamptz);
CREATE TABLE public.partner_offers (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, kind text NOT NULL DEFAULT 'installer', status text default 'pending', expires_at timestamptz, responded_by uuid, responded_at timestamptz, superseded_at timestamptz,
  CONSTRAINT partner_offers_kind_check CHECK (kind IN ('installer','piesa','rectification')));
CREATE UNIQUE INDEX partner_offers_one_pending_installer ON public.partner_offers(job_id) WHERE status='pending' AND kind='installer';
CREATE TABLE public.contact_releases (id uuid primary key default gen_random_uuid(), job_id uuid, assignment_id uuid, visit_kind text, released_by uuid, owner_notice text, trade_notice text, UNIQUE (assignment_id, visit_kind));
CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
INSERT INTO properties VALUES ('${PROP}','3199');
INSERT INTO jobs VALUES ('${JOB}','${PROP}','ready_check_ready_to_schedule');
INSERT INTO partner_offers (job_id,business_id,kind,status) VALUES ('${JOB}','${B1}','installer','declined');
`;
let db: PGlite;
const q1 = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0]!;
const n = async (sql: string) => (await q1<{ n: number }>(`SELECT count(*)::int n FROM ${sql}`)).n;
async function installer(biz: string, user: string, level: "full" | "provisional" | null = "full", expires = "2099-01-01") {
  await db.exec(`INSERT INTO businesses (id,name) VALUES ('${biz}','TEST ${biz.slice(-1)}'); INSERT INTO business_members VALUES ('${biz}','${user}');`);
  const w = await q1<{ id: string }>(`INSERT INTO partner_workers (business_id,trade_role,approval_status,email) VALUES ('${biz}','installer','approved','w${biz.slice(-1)}@test.invalid') RETURNING id`);
  const c = await q1<{ id: string }>(`INSERT INTO partner_worker_certifications (worker_id,worker_email,status) VALUES ('${w.id}','w${biz.slice(-1)}@test.invalid','verified') RETURNING id`);
  if (level) await db.exec(`INSERT INTO worker_certification_levels (certification_id,level,expires_on) VALUES ('${c.id}','${level}','${expires}')`);
}
const offer = async (biz: string) => (await q1<{ id: string }>(`INSERT INTO partner_offers (job_id,business_id,kind,expires_at) VALUES ('${JOB}','${biz}','ready_check',now()+interval '4 hours') RETURNING id`)).id;
const win = async (h: number) => (await q1<{ id: string }>(`INSERT INTO ready_check_windows (job_id,round,starts_at,ends_at) VALUES ('${JOB}',1,now()+interval '${h} hours',now()+interval '${h + 4} hours') RETURNING id`)).id;
const tap = async (o: string, u: string, w: string | null) => (await q1<{ outcome: string }>(`SELECT * FROM accept_ready_check_offer('${o}','${u}',${w ? `'${w}'` : "NULL"})`)).outcome;

beforeEach(async () => { db = new PGlite(); await db.exec(BASE); await db.exec(read("0099_ready_check_windows.sql")); });

describe("0099 Ready Check windows (practice database)", () => {
  test("existing rows unchanged; running twice is safe; several Ready Check offers can be open at once", async () => {
    await db.exec(read("0099_ready_check_windows.sql"));
    expect((await q1<{ kind: string; status: string }>(`SELECT kind,status FROM partner_offers`))).toEqual({ kind: "installer", status: "declined" });
    await installer(B1, U1); await installer(B2, U2);
    await offer(B1); await offer(B2);
    expect(await n(`partner_offers WHERE kind='ready_check' AND status='pending'`)).toBe(2);
  });
  test("first tap books that window, closes other windows and offers, releases contact for the Ready Check only", async () => {
    await installer(B1, U1); await installer(B2, U2);
    const [o1, o2] = [await offer(B1), await offer(B2)];
    const [w1, w2] = [await win(72), await win(96)];
    expect(await tap(o1, U1, w2)).toBe("accepted");
    expect((await q1<{ status: string }>(`SELECT status FROM ready_check_windows WHERE id='${w2}'`)).status).toBe("taken");
    expect((await q1<{ status: string }>(`SELECT status FROM ready_check_windows WHERE id='${w1}'`)).status).toBe("closed");
    expect((await q1<{ status: string }>(`SELECT status FROM partner_offers WHERE id='${o2}'`)).status).toBe("withdrawn");
    expect((await db.query<{ visit_kind: string }>(`SELECT visit_kind FROM contact_releases`)).rows.map((r) => r.visit_kind)).toEqual(["ready_check"]);
    expect(await tap(o2, U2, w1)).toBe("already_withdrawn");
    expect(await n(`job_assignments WHERE role='installer'`)).toBe(1);
  });
  test("refused: not Full, expired certification, no level recorded, passed window, wrong stage, out of area", async () => {
    await installer(B1, U1, "provisional");
    expect(await tap(await offer(B1), U1, await win(72))).toBe("not_qualified");
    db = new PGlite(); await db.exec(BASE); await db.exec(read("0099_ready_check_windows.sql"));
    await installer(B1, U1, "full", "2020-01-01");
    expect(await tap(await offer(B1), U1, null)).toBe("not_qualified");
    db = new PGlite(); await db.exec(BASE); await db.exec(read("0099_ready_check_windows.sql"));
    await installer(B1, U1, null);
    expect(await tap(await offer(B1), U1, null)).toBe("not_qualified");
    db = new PGlite(); await db.exec(BASE); await db.exec(read("0099_ready_check_windows.sql"));
    await installer(B1, U1);
    expect(await tap(await offer(B1), U1, await win(-1))).toBe("slot_unavailable");
    await db.exec(`UPDATE jobs SET stage='ready_check_scheduled'`);
    expect(await tap((await q1<{ id: string }>(`SELECT id FROM partner_offers WHERE kind='ready_check'`)).id, U1, null)).toBe("job_not_ready");
    await db.exec(`UPDATE jobs SET stage='ready_check_ready_to_schedule'; UPDATE businesses SET service_postcodes=ARRAY['3000']`);
    expect(await tap((await q1<{ id: string }>(`SELECT id FROM partner_offers WHERE kind='ready_check'`)).id, U1, null)).toBe("out_of_area");
    expect(await n(`job_assignments`)).toBe(0);
  });
  test("fallback (no window) assigns, closes the owner's windows and releases the Ready Check contact", async () => {
    await installer(B1, U1);
    const o = await offer(B1); await win(72);
    expect(await tap(o, U1, null)).toBe("accepted");
    expect(await n(`ready_check_windows WHERE status='closed'`)).toBe(1);
    expect(await n(`contact_releases WHERE visit_kind='ready_check'`)).toBe(1);
  });
  test("rollback is clean", async () => {
    await db.exec(read("0099_ready_check_windows.rollback.sql"));
    expect(await n(`information_schema.tables WHERE table_name='ready_check_windows'`)).toBe(0);
    expect((await q1<{ kind: string }>(`SELECT kind FROM partner_offers`)).kind).toBe("installer");
  });
});
