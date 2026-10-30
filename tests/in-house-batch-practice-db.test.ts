import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
    CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE profiles(id uuid primary key); CREATE TABLE auth.users(id uuid primary key);
    INSERT INTO profiles VALUES ('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}');
    INSERT INTO auth.users VALUES ('${id(1)}');
    CREATE TABLE user_roles(user_id uuid,role text); INSERT INTO user_roles VALUES ('${id(1)}','admin');
    CREATE TABLE businesses(id uuid primary key,name text,trading_name text,in_house boolean,is_active boolean);
    INSERT INTO businesses VALUES ('${id(10)}','Rapid Insulation','Rapid Insulation',true,true),('${id(11)}','Other','Other',false,true);
    CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean);
    INSERT INTO business_members VALUES ('${id(10)}','${id(2)}',true),('${id(10)}','${id(3)}',true);
    CREATE TABLE partner_workers(business_id uuid,profile_id uuid,trade_role text,approval_status text,removed_at timestamptz,licence_expires_on date);
    INSERT INTO partner_workers VALUES ('${id(10)}','${id(2)}','installer','approved',null,null),('${id(10)}','${id(3)}','electrician','approved',null,'2099-01-01');
    CREATE TABLE jobs(id uuid primary key,source text not null default 'base44',stage text not null default 'preliminary_estimate_ready',deleted_at timestamptz,electrician_choice text);
    INSERT INTO jobs(id) SELECT ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid FROM generate_series(20,29) n;
    CREATE TABLE lead_campaign_responses(job_id uuid,spot_saved_at timestamptz); INSERT INTO lead_campaign_responses SELECT id,now() FROM jobs;
    CREATE TABLE customer_email_optouts(id uuid primary key default gen_random_uuid(),job_id uuid not null,token text not null,opted_out_at timestamptz,created_at timestamptz not null default now());
    CREATE TABLE job_assignments(id uuid primary key default gen_random_uuid(),job_id uuid not null REFERENCES jobs(id),user_id uuid not null REFERENCES profiles(id),role text not null,business_id uuid REFERENCES businesses(id),active boolean not null default true,assigned_by uuid REFERENCES profiles(id),assigned_at timestamptz not null default now(),ended_at timestamptz,end_reason text);
    CREATE TABLE workflow_events(id uuid primary key default gen_random_uuid(),job_id uuid REFERENCES jobs(id),actor_id uuid REFERENCES profiles(id),event_type text not null,summary text not null,details jsonb,internal boolean default true,CONSTRAINT workflow_events_job_required CHECK (job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched','email_unmatched_dismissed','email_new_sender_replied','email_nojob_ai_draft','email_nojob_reply_sent','email_nojob_ai_draft_closed','email_nojob_followup_claim','email_nojob_followup_failed','email_nojob_ai_draft_failed'])));
    CREATE TABLE admin_config_events(id uuid primary key default gen_random_uuid(),actor_id uuid,event_type text not null,summary text not null,details jsonb not null,created_at timestamptz not null default now());
    CREATE TABLE customer_communication_templates(id uuid primary key default gen_random_uuid(),template_key text not null,version text not null,subject text not null,body_markdown text not null,status text not null default 'draft' CHECK(status IN ('draft','approved','superseded')),regulated_copy_locked boolean not null default false,source_note text,created_by uuid not null REFERENCES auth.users(id),created_at timestamptz not null default now(),approved_by uuid REFERENCES auth.users(id),approved_at timestamptz,UNIQUE(template_key,version));
    CREATE TABLE customer_email_sends(id uuid primary key default gen_random_uuid(),job_id uuid not null REFERENCES jobs(id),purpose text not null,idempotency_key text not null unique,status text not null default 'sending' CHECK(status IN ('sending','sent','failed','delivered_unrecorded')),error text,created_at timestamptz not null default now());`);
  await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_batch.sql", "utf8"));
  return db;
}
async function send(db: PGlite, job = 20, business = 10, actor = 1, installer = 2, electrician = 3) {
  return (await db.query<{ result: { sent: boolean; reason?: string } }>(`SELECT allocate_in_house_batch_job($1,$2,$3,$4,$5,$6) result`, [id(50),id(business),id(job),id(actor),id(installer),id(electrician)])).rows[0]?.result;
}
test("atomic allocation writes two assignments, preferred choice and a job-bound event; draft email remains unqueued", async () => {
  const db = await setup(); try {
    expect(await send(db)).toEqual({ sent: true });
    expect((await db.query("SELECT role,business_id::text,active,assigned_by::text FROM job_assignments ORDER BY role")).rows).toEqual([
      { role: "electrician",business_id: id(10),active: true,assigned_by: id(1) },{ role: "installer",business_id: id(10),active: true,assigned_by: id(1) }]);
    expect((await db.query("SELECT electrician_choice FROM jobs WHERE id=$1",[id(20)])).rows).toEqual([{ electrician_choice: "preferred" }]);
    expect((await db.query("SELECT job_id::text,actor_id::text,event_type,details FROM workflow_events")).rows).toEqual([{ job_id: id(20),actor_id: id(1),event_type: "in_house_batch_sent",details: { batch_id: id(50),business_id: id(10) } }]);
    expect((await db.query("SELECT * FROM customer_email_sends")).rows).toHaveLength(0);
    expect((await db.query("SELECT status FROM customer_communication_templates")).rows).toEqual([{ status: "draft" }]);
    expect(await send(db)).toEqual({ sent: false,reason: "Already with Rapid Insulation" });
    expect((await db.query("SELECT * FROM job_assignments")).rows).toHaveLength(2);
    expect((await db.query("SELECT * FROM in_house_batches")).rows).toHaveLength(1);
  } finally { await db.close(); }
});
test("approved template queues exactly one held email without delivery, with approved version recorded", async () => {
  const db = await setup(); try {
    await db.exec(`UPDATE customer_communication_templates SET status='approved',approved_by='${id(1)}',approved_at=now()`);
    expect(await send(db)).toEqual({ sent: true }); expect(await send(db)).toMatchObject({ sent: false });
    expect((await db.query("SELECT purpose,status,error FROM customer_email_sends")).rows).toEqual([{ purpose: "in_house_partner_will_call",status: "failed",error: "queued: awaiting guarded delivery" }]);
  } finally { await db.close(); }
});
test("refuses excluded jobs and invalid workers without partial writes", async () => {
  const db = await setup(); try {
    await db.exec(`UPDATE jobs SET deleted_at=now() WHERE id='${id(21)}'; UPDATE jobs SET source='qa_test' WHERE id='${id(22)}'; INSERT INTO customer_email_optouts(job_id,token,opted_out_at) VALUES ('${id(23)}','optout',now()); DELETE FROM lead_campaign_responses WHERE job_id='${id(24)}'; UPDATE jobs SET stage='complete' WHERE id='${id(25)}';`);
    for (const j of [21,22,23,24,25]) expect(await send(db,j)).toMatchObject({ sent: false });
    expect(await send(db,26,11)).toMatchObject({ sent: false });
    expect(await send(db,26,10,1,2,4)).toMatchObject({ sent: false });
    expect((await db.query("SELECT * FROM job_assignments")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM in_house_batches")).rows).toHaveLength(0);
  } finally { await db.close(); }
});
test("two non-admin identities cannot read batches or call the RPC; undo removes only task objects and its draft", async () => {
  const db = await setup(); try {
    await send(db);
    await db.exec("GRANT USAGE ON SCHEMA public,auth TO authenticated; SET ROLE authenticated");
    for (const actor of [2,4]) { expect((await db.query("SELECT * FROM in_house_batches")).rows).toEqual([]); await expect(send(db,27,10,actor)).rejects.toThrow("permission denied"); }
    await db.exec("RESET ROLE");
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_batch.undo.sql","utf8"));
    expect((await db.query("SELECT * FROM customer_communication_templates")).rows).toHaveLength(0);
    expect((await db.query("SELECT to_regclass('public.in_house_batches') AS name")).rows).toEqual([{ name: null }]);
    expect((await db.query("SELECT proname FROM pg_proc WHERE proname='allocate_in_house_batch_job'")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(1);
  } finally { await db.close(); }
});