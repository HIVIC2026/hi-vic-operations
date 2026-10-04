// Practice database (PGlite) for 0093: owner-picked PIESA windows; tapping a window = accept + take that time. Fake TEST rows only.
// PGlite is single-connection, so "two electricians at once" is proven by the row lock + offer lock ordering run back to back.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const U = { rec: "00000000-0000-4000-8000-000000000001", rec2: "00000000-0000-4000-8000-000000000002", inst: "00000000-0000-4000-8000-000000000003", owner: "00000000-0000-4000-8000-000000000004" };
const B = "10000000-0000-4000-8000-000000000001", B2 = "10000000-0000-4000-8000-000000000002", JOB = "20000000-0000-4000-8000-000000000001", OWNER = "30000000-0000-4000-8000-000000000001", PROP = "40000000-0000-4000-8000-000000000001";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TYPE assignment_role AS ENUM ('electrician','installer','property_manager');
CREATE TYPE job_stage AS ENUM ('ready_check_scheduled','measured_quote_accepted','piesa_and_install_window_pending','piesa_scheduled','rectification_scheduling','installation_scheduling','complete');
CREATE TABLE public.profiles (id uuid primary key);
CREATE TABLE public.businesses (id uuid primary key, name text not null, is_active boolean not null default true, onboarding_status text not null default 'draft',
  licence_number text, rec_number text, coverage_verified_at timestamptz, service_postcodes text[]);
CREATE TABLE public.business_members (id uuid primary key default gen_random_uuid(), business_id uuid not null, user_id uuid not null);
CREATE TABLE public.partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role assignment_role, approval_status text, removed_at timestamptz);
CREATE TABLE public.owners (id uuid primary key, user_id uuid, full_name text);
CREATE TABLE public.properties (id uuid primary key, postcode text);
CREATE TABLE public.jobs (id uuid primary key, owner_id uuid, property_id uuid, stage job_stage not null);
CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id), user_id uuid not null references profiles(id), role assignment_role not null, business_id uuid, active boolean not null default true, assigned_by uuid references profiles(id), assigned_at timestamptz not null default now());
CREATE TABLE public.partner_offers (id uuid primary key default gen_random_uuid(), job_id uuid not null, business_id uuid not null, status text not null default 'pending', summary jsonb not null default '{}', offered_by uuid, offered_at timestamptz not null default now(), expires_at timestamptz, responded_by uuid, responded_at timestamptz, decline_reason text);
CREATE UNIQUE INDEX partner_offers_one_pending ON public.partner_offers(job_id) WHERE status = 'pending';
CREATE TABLE public.workflow_settings (id integer primary key default 1);
CREATE TABLE public.piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text);
CREATE TYPE booking_kind AS ENUM ('assessment','rectification','installation','ready_check');
CREATE TABLE public.appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id), kind booking_kind not null default 'assessment', assignment_id uuid references job_assignments(id), proposed_by uuid not null references profiles(id), proposer_role text not null, starts_at timestamptz not null, ends_at timestamptz, note text, status text not null default 'proposed' check (status in ('proposed','accepted','declined','superseded','cancelled')), responded_by uuid, responded_at timestamptz, response_note text, created_at timestamptz not null default now());
CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.can_access_job(_job uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_or_assignee ON public.owners FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.owners, public.jobs, public.job_assignments TO authenticated;
INSERT INTO workflow_settings DEFAULT VALUES;
INSERT INTO profiles VALUES ('${U.rec}'),('${U.rec2}'),('${U.inst}'),('${U.owner}');
INSERT INTO businesses VALUES ('${B}','TEST REC',true,'approved','A1',null,now(),ARRAY['3199']);
INSERT INTO business_members (business_id,user_id) VALUES ('${B}','${U.rec}');
INSERT INTO partner_workers (business_id,trade_role,approval_status) VALUES ('${B}','electrician','approved');
INSERT INTO owners VALUES ('${OWNER}','${U.owner}','TEST Owner');
INSERT INTO properties VALUES ('${PROP}','3199');
INSERT INTO jobs VALUES ('${JOB}','${OWNER}','${PROP}','piesa_and_install_window_pending');
`;
let db: PGlite;
const q1 = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0]!;
const offer = async (biz: string) => (await db.exec(`UPDATE partner_offers SET status='withdrawn' WHERE status='pending' AND business_id='${biz}'`), await q1<{ id: string }>(`INSERT INTO partner_offers (job_id,business_id,kind,expires_at) VALUES ('${JOB}','${biz}','piesa',now()+interval '2 hours') RETURNING id`)).id;
const win = async (hoursAhead: number, round = 1) => (await q1<{ id: string }>(`INSERT INTO appointment_proposals (job_id,kind,proposed_by,proposer_role,starts_at,ends_at,piesa_window_round) VALUES ('${JOB}','assessment','${U.owner}','owner',now()+interval '${hoursAhead} hours',now()+interval '${hoursAhead + 4} hours',${round}) RETURNING id`)).id;
const tap = async (o: string, user: string, p: string) => (await q1<{ outcome: string }>(`SELECT * FROM accept_partner_offer_slot('${o}','${user}','${p}')`)).outcome;
const setup = async () => {
  db = new PGlite(); await db.exec(BASE);
  for (const f of ["0086_piesa_allocation_self_scheduling.sql", "0087_allocation_hardening.sql", "0088_offer_batch_index.sql"]) await db.exec(read(f));
  await db.exec(`INSERT INTO businesses VALUES ('${B2}','TEST REC 2',true,'approved','A2',null,now(),ARRAY['3199']); INSERT INTO business_members (business_id,user_id) VALUES ('${B2}','${U.rec2}'); INSERT INTO partner_workers (business_id,trade_role,approval_status) VALUES ('${B2}','electrician','approved');`);
};
beforeEach(async () => { await setup(); await db.exec(read("0093_piesa_owner_windows.sql")); });

describe("0093 owner-picked PIESA windows (practice database)", () => {
  test("first tap accepts, takes that time, closes the other times and offers, releases contacts for the PIESA only", async () => {
    const [o1, o2] = [await offer(B), await offer(B2)];
    const [w1, w2, w3] = [await win(72), await win(96), await win(120)];
    expect(await tap(o1, U.rec, w2)).toBe("accepted");
    const props = (await db.query<{ id: string; status: string; assignment_id: string | null }>(`SELECT id, status, assignment_id FROM appointment_proposals`)).rows;
    expect(props.find((p) => p.id === w2)!.status).toBe("accepted");
    expect(props.find((p) => p.id === w2)!.assignment_id).not.toBeNull();
    expect(props.filter((p) => [w1, w3].includes(p.id)).every((p) => p.status === "superseded")).toBe(true);
    expect((await q1<{ status: string }>(`SELECT status FROM partner_offers WHERE id='${o2}'`)).status).toBe("withdrawn");
    const rel = (await db.query<{ visit_kind: string }>(`SELECT visit_kind FROM contact_releases`)).rows;
    expect(rel.map((r) => r.visit_kind)).toEqual(["piesa"]);
    expect((await q1<{ n: number }>(`SELECT count(*)::int n FROM job_assignments WHERE role='electrician' AND active`)).n).toBe(1);
  });
  test("second electrician tapping straight after (same or another time) is refused and nothing changes", async () => {
    const [o1, o2] = [await offer(B), await offer(B2)];
    const [w1, w2] = [await win(72), await win(96)];
    expect(await tap(o1, U.rec, w1)).toBe("accepted");
    expect(await tap(o2, U.rec2, w1)).toBe("slot_unavailable");
    expect(await tap(o2, U.rec2, w2)).toBe("slot_unavailable"); // other times were closed by the first tap
    expect((await q1<{ n: number }>(`SELECT count(*)::int n FROM job_assignments WHERE role='electrician'`)).n).toBe(1);
    expect((await q1<{ n: number }>(`SELECT count(*)::int n FROM contact_releases`)).n).toBe(1);
  });
  test("passed times, ordinary proposals and another job's times are refused", async () => {
    const o = await offer(B);
    const past = await win(-1);
    expect(await tap(o, U.rec, past)).toBe("slot_unavailable");
    const plain = (await q1<{ id: string }>(`INSERT INTO appointment_proposals (job_id,kind,proposed_by,proposer_role,starts_at) VALUES ('${JOB}','assessment','${U.owner}','owner',now()+interval '3 days') RETURNING id`)).id;
    expect(await tap(o, U.rec, plain)).toBe("slot_unavailable");
    expect((await q1<{ n: number }>(`SELECT count(*)::int n FROM job_assignments`)).n).toBe(0);
  });
  test("existing acceptance checks still apply (wrong stage, out of area, not a member)", async () => {
    const w = await win(72);
    await db.exec(`UPDATE jobs SET stage='measured_quote_accepted'`); expect(await tap(await offer(B), U.rec, w)).toBe("job_not_ready");
    await db.exec(`UPDATE jobs SET stage='piesa_and_install_window_pending'; UPDATE businesses SET service_postcodes=ARRAY['3000'] WHERE id='${B}'`);
    expect(await tap(await offer(B), U.rec, w)).toBe("out_of_area");
    expect(await tap(await offer(B2), U.rec, w)).toBe("not_member");
    expect((await q1<{ status: string }>(`SELECT status FROM appointment_proposals WHERE id='${w}'`)).status).toBe("proposed");
  });
  test("fallback: the old accept path still works unchanged", async () => {
    await win(72);
    expect((await q1<{ outcome: string }>(`SELECT * FROM accept_partner_offer('${await offer(B)}','${U.rec}')`)).outcome).toBe("accepted");
  });
  test("not callable by signed-in users directly", async () => {
    const r = await q1<{ ok: boolean }>(`SELECT has_function_privilege('authenticated','public.accept_partner_offer_slot(uuid,uuid,uuid)','EXECUTE') ok`);
    expect(r.ok).toBe(false);
  });
});

describe("0093 is additive and reversible", () => {
  test("existing proposals unchanged; rollback removes only the new parts", async () => {
    await setup();
    await db.exec(`INSERT INTO appointment_proposals (job_id,kind,proposed_by,proposer_role,starts_at,status) VALUES ('${JOB}','assessment','${U.owner}','owner',now()+interval '1 day','proposed'),('${JOB}','installation','${U.inst}','installer',now()+interval '9 days','accepted')`);
    const snap = async () => (await db.query(`SELECT id, job_id, kind::text, status, starts_at::text FROM appointment_proposals ORDER BY id`)).rows;
    const before = await snap();
    await db.exec(read("0093_piesa_owner_windows.sql"));
    expect(await snap()).toEqual(before);
    expect((await q1<{ n: number }>(`SELECT count(*)::int n FROM appointment_proposals WHERE piesa_window_round IS NOT NULL`)).n).toBe(0);
    await db.exec(read("0093_piesa_owner_windows.rollback.sql"));
    expect(await snap()).toEqual(before);
    expect((await q1<{ n: number }>(`SELECT count(*)::int n FROM pg_proc WHERE proname='accept_partner_offer_slot'`)).n).toBe(0);
    expect((await q1<{ outcome: string }>(`SELECT * FROM accept_partner_offer('${await offer(B)}','${U.rec}')`)).outcome).toBe("accepted");
  });
});
