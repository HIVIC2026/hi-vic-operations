// Pending 2026-11-05_test_office_give.sql (Jo 5 Nov 2026): the TEST office may give a qa_test job to a TEST partner
// through the normal atomic allocation RPC; the admin path is unchanged. Proven on PGlite over the current function body
// (journaled 0181/0182 baseline; same setup as in-house-batch-practice-db: batch + coverage + quick taps + Team electrician), then rolled back.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const ADMIN = 1, QA = 5, TEST_BIZ = 13, REAL_BIZ = 10, TEST_INSTALLER = 6, REAL_INSTALLER = 2, TEST_JOB = 30, REAL_JOB = 20;
async function setup(apply = true) {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE profiles(id uuid primary key,email text,mitti_user_id text,mitti_checked_email text,mitti_checked_at timestamptz); CREATE TABLE auth.users(id uuid primary key);
    INSERT INTO profiles(id) VALUES ('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(5)}'),('${id(6)}');
    INSERT INTO auth.users VALUES ('${id(1)}');
    CREATE TABLE user_roles(user_id uuid,role text); INSERT INTO user_roles VALUES ('${id(ADMIN)}','admin'),('${id(QA)}','qa_office');
    CREATE TABLE businesses(id uuid primary key,name text,trading_name text,email text,onboarding_notes text,in_house boolean,pays_own_electricians boolean not null default false,is_active boolean,coverage_lat double precision,coverage_lng double precision,coverage_radius_km integer,service_postcodes text[] default '{}',covers_all_victoria boolean default false);
    INSERT INTO businesses(id,name,trading_name,email,onboarding_notes,in_house,is_active,service_postcodes) VALUES
      ('${id(REAL_BIZ)}','Rapid Insulation','Rapid Insulation','office@rapid.example',null,true,true,ARRAY['3199']),
      ('${id(TEST_BIZ)}','[TEST PARTNER] Bravo','Bravo TEST','bravo@hivic-test.example','[TEST PARTNER] journey',true,true,ARRAY['3199']);
    CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean);
    INSERT INTO business_members VALUES ('${id(REAL_BIZ)}','${id(REAL_INSTALLER)}',true),('${id(TEST_BIZ)}','${id(TEST_INSTALLER)}',true);
    CREATE TABLE partner_workers(business_id uuid,profile_id uuid,trade_role text,approval_status text,removed_at timestamptz,licence_expires_on date,email text);
    INSERT INTO partner_workers(business_id,profile_id,trade_role,approval_status) VALUES ('${id(REAL_BIZ)}','${id(REAL_INSTALLER)}','installer','approved'),('${id(TEST_BIZ)}','${id(TEST_INSTALLER)}','installer','approved');
    CREATE TABLE properties(id uuid primary key,postcode text); INSERT INTO properties VALUES ('${id(12)}','3199');
    CREATE TABLE property_facts(property_id uuid,fact_key text,value jsonb,is_current boolean,created_at timestamptz default now());
    CREATE TABLE jobs(id uuid primary key,source text not null default 'base44',stage text not null default 'preliminary_estimate_ready',deleted_at timestamptz,qa_archived_at timestamptz,electrician_choice text,property_id uuid default '${id(12)}');
    INSERT INTO jobs(id,source) VALUES ('${id(REAL_JOB)}','base44'),('${id(21)}','base44'),('${id(TEST_JOB)}','qa_test'),('${id(31)}','qa_test');
    CREATE TABLE lead_campaign_responses(job_id uuid,spot_saved_at timestamptz); INSERT INTO lead_campaign_responses SELECT id,now() FROM jobs;
    CREATE TABLE customer_email_optouts(id uuid primary key default gen_random_uuid(),job_id uuid not null,token text not null,opted_out_at timestamptz,created_at timestamptz not null default now());
    CREATE TABLE job_assignments(id uuid primary key default gen_random_uuid(),job_id uuid not null REFERENCES jobs(id),user_id uuid not null REFERENCES profiles(id),role text not null,business_id uuid REFERENCES businesses(id),active boolean not null default true,assigned_by uuid REFERENCES profiles(id),assigned_at timestamptz not null default now(),ended_at timestamptz,end_reason text);
    CREATE UNIQUE INDEX job_assignments_active_uq ON job_assignments(job_id,role) WHERE active;
    CREATE TABLE workflow_events(id uuid primary key default gen_random_uuid(),job_id uuid REFERENCES jobs(id),actor_id uuid REFERENCES profiles(id),event_type text not null,summary text not null,details jsonb,internal boolean default true);
    CREATE TABLE admin_config_events(id uuid primary key default gen_random_uuid(),actor_id uuid,event_type text not null,summary text not null,details jsonb not null,created_at timestamptz not null default now());
    CREATE TABLE customer_communication_templates(id uuid primary key default gen_random_uuid(),template_key text not null,version text not null,subject text not null,body_markdown text not null,status text not null default 'draft' CHECK(status IN ('draft','approved','superseded')),regulated_copy_locked boolean not null default false,source_note text,created_by uuid not null REFERENCES auth.users(id),created_at timestamptz not null default now(),approved_by uuid REFERENCES auth.users(id),approved_at timestamptz,UNIQUE(template_key,version));
    CREATE TABLE customer_email_sends(id uuid primary key default gen_random_uuid(),job_id uuid not null REFERENCES jobs(id),purpose text not null,idempotency_key text not null unique,status text not null default 'sending',error text,created_at timestamptz not null default now());`);
  await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_batch.sql", "utf8"));
  await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_batch_coverage.sql", "utf8"));
  await db.exec("ALTER TABLE jobs ADD COLUMN channel text DEFAULT 'hivic_sourced'; ALTER TABLE workflow_events ADD COLUMN created_at timestamptz DEFAULT now();");
  await db.exec(readFileSync("drizzle/migrations/0181_in_house_quick_taps.sql", "utf8"));
  await db.exec("ALTER TABLE partner_workers ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN full_legal_name text, ADD COLUMN licence_number text;");
  await db.exec(readFileSync("drizzle/migrations/0182_in_house_team_electrician.sql", "utf8"));
  await db.exec(`INSERT INTO workflow_events(job_id,event_type,summary,details) SELECT id,'quick_taps_answered','yes','{"outcome":"pass","consent_share":true}' FROM jobs`);
  if (apply) await db.exec(readFileSync("drizzle/migrations/0189_test_office_give.sql", "utf8"));
  return db;
}
const give = async (db: PGlite, job: number, business: number, actor: number, installer: number) =>
  (await db.query<{ result: { sent: boolean; reason?: string } }>("SELECT allocate_in_house_batch_job($1,$2,$3,$4,$5,NULL) result", [id(50 + job), id(business), id(job), id(actor), id(installer)])).rows[0]?.result;
const writes = async (db: PGlite) => ({
  assignments: (await db.query("SELECT count(*)::int n FROM job_assignments")).rows[0],
  batches: (await db.query("SELECT count(*)::int n FROM in_house_batches")).rows[0],
  events: (await db.query("SELECT count(*)::int n FROM workflow_events WHERE event_type<>'quick_taps_answered'")).rows[0],
});
const FN = "'allocate_in_house_batch_job(uuid,uuid,uuid,uuid,uuid,uuid)'::regprocedure";
const fnShape = async (db: PGlite) => (await db.query<{ def: string; prosecdef: boolean; proconfig: string[] | null; proacl: string[] | null }>(
  `SELECT pg_get_functiondef(${FN}) def, prosecdef, proconfig, proacl::text[] proacl FROM pg_proc WHERE oid=${FN}`)).rows[0]!;
const REFUSED = "The TEST office can only give TEST jobs to TEST installers";

test("before the change (today): the TEST office cannot give at all", async () => {
  const db = await setup(false);
  try { await expect(give(db, TEST_JOB, TEST_BIZ, QA, TEST_INSTALLER)).rejects.toThrow("Office only"); } finally { await db.close(); }
});
test("TEST office gives a qa_test job to a TEST partner: the normal give records are written", async () => {
  const db = await setup();
  try {
    expect(await give(db, TEST_JOB, TEST_BIZ, QA, TEST_INSTALLER)).toEqual({ sent: true });
    expect((await db.query("SELECT job_id::text,user_id::text,role,business_id::text,active,assigned_by::text FROM job_assignments")).rows).toEqual([
      { job_id: id(TEST_JOB), user_id: id(TEST_INSTALLER), role: "installer", business_id: id(TEST_BIZ), active: true, assigned_by: id(QA) }]);
    expect((await db.query("SELECT business_id::text,job_ids::text[],sent_by::text FROM in_house_batches")).rows).toEqual([{ business_id: id(TEST_BIZ), job_ids: [id(TEST_JOB)], sent_by: id(QA) }]);
    expect((await db.query("SELECT event_type,actor_id::text FROM workflow_events WHERE event_type<>'quick_taps_answered' ORDER BY event_type")).rows).toEqual([
      { event_type: "in_house_batch_sent", actor_id: id(QA) }, { event_type: "in_house_partner_call_email_pending", actor_id: id(QA) }]);
    // The normal one-installer lock still applies to TEST jobs.
    expect(await give(db, TEST_JOB, TEST_BIZ, QA, TEST_INSTALLER)).toEqual({ sent: false, reason: "Already with Bravo TEST" });
  } finally { await db.close(); }
});
test("TEST office + a real job → refused before any write", async () => {
  const db = await setup();
  try {
    await expect(give(db, REAL_JOB, TEST_BIZ, QA, TEST_INSTALLER)).rejects.toThrow(REFUSED);
    expect(await writes(db)).toEqual({ assignments: { n: 0 }, batches: { n: 0 }, events: { n: 0 } });
  } finally { await db.close(); }
});
test("TEST office + a real business (or a TEST mark without the TEST email domain) → refused before any write", async () => {
  const db = await setup();
  try {
    await expect(give(db, TEST_JOB, REAL_BIZ, QA, REAL_INSTALLER)).rejects.toThrow(REFUSED);
    await db.exec(`UPDATE businesses SET email='bravo@gmail.com' WHERE id='${id(TEST_BIZ)}'`);
    await expect(give(db, TEST_JOB, TEST_BIZ, QA, TEST_INSTALLER)).rejects.toThrow(REFUSED);
    await db.exec(`UPDATE businesses SET email='bravo@hivic-test.example',onboarding_notes='journey' WHERE id='${id(TEST_BIZ)}'`);
    await expect(give(db, TEST_JOB, TEST_BIZ, QA, TEST_INSTALLER)).rejects.toThrow(REFUSED);
    expect(await writes(db)).toEqual({ assignments: { n: 0 }, batches: { n: 0 }, events: { n: 0 } });
  } finally { await db.close(); }
});
test("a qa_office actor that is also admin is still refused", async () => {
  const db = await setup();
  try {
    await db.exec(`INSERT INTO user_roles VALUES ('${id(QA)}','admin')`);
    await expect(give(db, TEST_JOB, TEST_BIZ, QA, TEST_INSTALLER)).rejects.toThrow("Office only");
  } finally { await db.close(); }
});
test("admin path unchanged: real job gives; qa_test job stays unavailable even to a TEST partner; non-office refused", async () => {
  const db = await setup();
  try {
    expect(await give(db, REAL_JOB, REAL_BIZ, ADMIN, REAL_INSTALLER)).toEqual({ sent: true });
    expect(await give(db, 31, TEST_BIZ, ADMIN, TEST_INSTALLER)).toEqual({ sent: false, reason: "Job unavailable" });
    await expect(give(db, 21, REAL_BIZ, REAL_INSTALLER, REAL_INSTALLER)).rejects.toThrow("Office only");
  } finally { await db.close(); }
});
test("an archived qa_test job is refused by the function for a qa_office caller (no writes)", async () => {
  const db = await setup();
  try {
    await db.exec(`UPDATE jobs SET qa_archived_at=now() WHERE id='${id(TEST_JOB)}'`);
    expect(await give(db, TEST_JOB, TEST_BIZ, QA, TEST_INSTALLER)).toEqual({ sent: false, reason: "Job unavailable" });
    expect(await writes(db)).toEqual({ assignments: { n: 0 }, batches: { n: 0 }, events: { n: 0 } });
  } finally { await db.close(); }
});
test("applying twice is a no-op; only the body changes (secdef/config/acl identical); rollback restores BEFORE byte for byte", async () => {
  const db = await setup(false);
  try {
    const before = await fnShape(db);
    await db.exec(readFileSync("drizzle/migrations/0189_test_office_give.sql", "utf8"));
    const applied = await fnShape(db);
    expect(applied.def).not.toBe(before.def);
    expect(applied.def).toContain("TEST office Give");
    expect({ ...applied, def: null }).toEqual({ ...before, def: null });
    await db.exec(readFileSync("drizzle/migrations/0189_test_office_give.sql", "utf8"));
    expect(await fnShape(db)).toEqual(applied);
    await db.exec(readFileSync("docs/applied-migrations/2026-11-05_test_office_give.rollback.sql", "utf8"));
    expect(await fnShape(db)).toEqual(before);
    await expect(give(db, TEST_JOB, TEST_BIZ, QA, TEST_INSTALLER)).rejects.toThrow("Office only");
    expect(await give(db, REAL_JOB, REAL_BIZ, ADMIN, REAL_INSTALLER)).toEqual({ sent: true });
  } finally { await db.close(); }
});
