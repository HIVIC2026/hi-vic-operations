// Practice database (PGlite, in-memory) for migration 0086. Fake TEST rows only; never touches the live database.
import { describe, expect, test, beforeEach } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const SQL = readFileSync(new URL("../docs/pending-migrations/0086_piesa_allocation_self_scheduling.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../docs/pending-migrations/0086_piesa_allocation_self_scheduling.rollback.sql", import.meta.url), "utf8");

const U = { rec1: "00000000-0000-4000-8000-000000000001", rec2: "00000000-0000-4000-8000-000000000002", inst: "00000000-0000-4000-8000-000000000003", owner: "00000000-0000-4000-8000-000000000004", stranger: "00000000-0000-4000-8000-000000000005" };
const B = { rec1: "10000000-0000-4000-8000-000000000001", rec2: "10000000-0000-4000-8000-000000000002", unapproved: "10000000-0000-4000-8000-000000000003" };
const JOB = "20000000-0000-4000-8000-000000000001", OWNER = "30000000-0000-4000-8000-000000000001";

const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
CREATE TYPE assignment_role AS ENUM ('electrician','installer','property_manager');
CREATE TABLE public.profiles (id uuid primary key);
CREATE TABLE public.businesses (id uuid primary key, name text not null, is_active boolean not null default true, onboarding_status text not null default 'draft');
CREATE TABLE public.business_members (id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id), user_id uuid not null references profiles(id));
CREATE TABLE public.owners (id uuid primary key, user_id uuid, full_name text, phone text, email text);
CREATE TABLE public.jobs (id uuid primary key, owner_id uuid references owners(id));
CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id) on delete cascade, user_id uuid not null references profiles(id), role assignment_role not null, business_id uuid references businesses(id), active boolean not null default true, assigned_by uuid references profiles(id), assigned_at timestamptz not null default now());
CREATE TABLE public.partner_offers (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id), business_id uuid not null references businesses(id), status text not null default 'pending' CHECK (status IN ('pending','accepted','declined','expired','withdrawn')), summary jsonb not null default '{}', offered_by uuid, offered_at timestamptz not null default now(), expires_at timestamptz, responded_by uuid, responded_at timestamptz, decline_reason text);
CREATE TABLE public.workflow_settings (id integer primary key default 1);
CREATE TABLE public.piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.quotes (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default now());
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.can_access_job(_job uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM job_assignments WHERE job_id=_job AND user_id=auth.uid() AND active) $$;
CREATE FUNCTION public.job_assignment_role(_job uuid, _user uuid) RETURNS assignment_role LANGUAGE sql STABLE AS $$ SELECT role FROM job_assignments WHERE job_id=_job AND user_id=_user AND active LIMIT 1 $$;
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_or_assignee ON public.owners FOR SELECT TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM jobs j WHERE j.owner_id = owners.id AND job_assignment_role(j.id, auth.uid()) IS NOT NULL));
GRANT SELECT ON public.owners, public.jobs, public.job_assignments TO authenticated;
INSERT INTO workflow_settings DEFAULT VALUES;
INSERT INTO profiles VALUES ('${U.rec1}'),('${U.rec2}'),('${U.inst}'),('${U.owner}'),('${U.stranger}');
INSERT INTO businesses VALUES ('${B.rec1}','TEST REC 1',true,'approved'),('${B.rec2}','TEST REC 2',true,'approved'),('${B.unapproved}','TEST REC 3',true,'submitted');
INSERT INTO business_members (business_id,user_id) VALUES ('${B.rec1}','${U.rec1}'),('${B.rec2}','${U.rec2}'),('${B.unapproved}','${U.stranger}');
INSERT INTO owners VALUES ('${OWNER}','${U.owner}','TEST Owner','0400000000','test@example.invalid');
INSERT INTO jobs VALUES ('${JOB}','${OWNER}');
INSERT INTO job_assignments (job_id,user_id,role,active) VALUES ('${JOB}','${U.inst}','installer',true);
`;

let db: PGlite;
const offer = async (biz: string, expires = "now() + interval '2 hours'") =>
  (await db.query<{ id: string }>(`INSERT INTO partner_offers (job_id,business_id,kind,expires_at) VALUES ('${JOB}','${biz}','piesa',${expires}) RETURNING id`)).rows[0]!.id;
const accept = async (id: string, user: string) => (await db.query<{ outcome: string }>(`SELECT * FROM accept_partner_offer('${id}','${user}')`)).rows[0]!.outcome;
const asUser = async <T,>(user: string, sql: string) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`);
  try { return (await db.query<T>(sql)).rows; } finally { await db.exec("RESET ROLE;"); }
};

beforeEach(async () => { db = new PGlite(); await db.exec(BASE); await db.exec(SQL); });

describe("0086 PIESA allocation (practice database)", () => {
  test("additive: existing offers default to installer; settings default 2h / batch 3", async () => {
    const s = (await db.query<{ rec_offer_expiry_hours: string; rec_offer_batch_size: number }>("SELECT rec_offer_expiry_hours, rec_offer_batch_size FROM workflow_settings")).rows[0]!;
    expect(Number(s.rec_offer_expiry_hours)).toBe(2);
    expect(s.rec_offer_batch_size).toBe(3);
    await db.exec(`INSERT INTO partner_offers (job_id,business_id) VALUES ('${JOB}','${B.rec1}')`);
    expect((await db.query<{ kind: string }>("SELECT kind FROM partner_offers")).rows[0]!.kind).toBe("installer");
  });
  test("existing active assignment keeps owner visibility via backfilled release", async () => {
    expect((await db.query("SELECT 1 FROM contact_releases")).rows.length).toBe(1);
    expect((await asUser(U.inst, "SELECT full_name FROM owners")).length).toBe(1);
  });
  test("first valid acceptance wins; competing and stale offers are rejected", async () => {
    const a = await offer(B.rec1), b = await offer(B.rec2);
    expect(await accept(a, U.rec1)).toBe("accepted");
    expect(await accept(b, U.rec2)).toBe("already_withdrawn");
    expect(await accept(a, U.rec1)).toBe("already_accepted");
    const n = (await db.query<{ c: number }>("SELECT count(*)::int c FROM job_assignments WHERE role='electrician' AND active")).rows[0]!.c;
    expect(n).toBe(1);
  });
  test("expired offers, non-members and unapproved partners cannot accept", async () => {
    expect(await accept(await offer(B.rec1, "now() - interval '1 minute'"), U.rec1)).toBe("expired");
    expect(await accept(await offer(B.rec1), U.rec2)).toBe("not_member");
    expect(await accept(await offer(B.unapproved), U.stranger)).toBe("partner_not_approved");
  });
  test("contact released only to the accepting REC, audited, and revoked when the assignment ends", async () => {
    expect((await asUser(U.rec1, "SELECT full_name FROM owners")).length).toBe(0); // offered only: no owner PII
    await accept(await offer(B.rec1), U.rec1);
    expect((await asUser(U.rec1, "SELECT phone FROM owners")).length).toBe(1);
    expect((await asUser(U.rec2, "SELECT phone FROM owners")).length).toBe(0);
    const ev = (await db.query<{ event_type: string }>("SELECT event_type FROM workflow_events ORDER BY event_type")).rows.map((r) => r.event_type);
    expect(ev).toEqual(["contact_released", "partner_offer_accepted"]);
    expect((await db.query("SELECT 1 FROM contact_releases WHERE visit_kind='piesa'")).rows.length).toBe(1);
    await db.exec(`UPDATE job_assignments SET active=false WHERE user_id='${U.rec1}'`);
    expect((await asUser(U.rec1, "SELECT phone FROM owners")).length).toBe(0);
  });
  test("acceptance function is not callable by signed-in users directly", async () => {
    const id = await offer(B.rec1);
    await expect(asUser(U.rec1, `SELECT * FROM accept_partner_offer('${id}','${U.rec1}')`)).rejects.toThrow();
  });
  test("rollback restores the previous owner policy", async () => {
    await db.exec(ROLLBACK);
    expect((await asUser(U.inst, "SELECT full_name FROM owners")).length).toBe(1);
  });
});
