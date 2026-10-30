import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE TABLE profiles(id uuid primary key,email text,mitti_user_id text,mitti_checked_email text,mitti_checked_at timestamptz); CREATE TABLE auth.users(id uuid primary key);
    INSERT INTO profiles(id) VALUES ('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}');
    UPDATE profiles SET email='electrician@example.invalid',mitti_user_id='m',mitti_checked_email='electrician@example.invalid',mitti_checked_at=now() WHERE id='${id(3)}';
    INSERT INTO auth.users VALUES ('${id(1)}');
    CREATE TABLE user_roles(user_id uuid,role text); INSERT INTO user_roles VALUES ('${id(1)}','admin');
    CREATE TABLE businesses(id uuid primary key,name text,trading_name text,in_house boolean,pays_own_electricians boolean not null default false,is_active boolean,coverage_lat double precision,coverage_lng double precision,coverage_radius_km integer,service_postcodes text[] default '{}',covers_all_victoria boolean default false);
    INSERT INTO businesses(id,name,trading_name,in_house,is_active,service_postcodes) VALUES ('${id(10)}','Rapid Insulation','Rapid Insulation',true,true,ARRAY['3199']),('${id(11)}','Other','Other',false,true,'{}');
    CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean);
    INSERT INTO business_members VALUES ('${id(10)}','${id(2)}',true),('${id(10)}','${id(3)}',true);
    CREATE TABLE partner_workers(business_id uuid,profile_id uuid,trade_role text,approval_status text,removed_at timestamptz,licence_expires_on date,email text);
    INSERT INTO partner_workers(business_id,profile_id,trade_role,approval_status,removed_at,licence_expires_on) VALUES ('${id(10)}','${id(2)}','installer','approved',null,null),('${id(10)}','${id(3)}','electrician','approved',null,'2099-01-01');
    CREATE TABLE properties(id uuid primary key,postcode text); INSERT INTO properties VALUES ('${id(12)}','3199');
    CREATE TABLE property_facts(property_id uuid,fact_key text,value jsonb,is_current boolean,created_at timestamptz default now());
    CREATE TABLE jobs(id uuid primary key,source text not null default 'base44',stage text not null default 'preliminary_estimate_ready',deleted_at timestamptz,electrician_choice text,property_id uuid default '${id(12)}');
    INSERT INTO jobs(id) SELECT ('00000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid FROM generate_series(20,29) n;
    CREATE TABLE lead_campaign_responses(job_id uuid,spot_saved_at timestamptz); INSERT INTO lead_campaign_responses SELECT id,now() FROM jobs;
    CREATE TABLE customer_email_optouts(id uuid primary key default gen_random_uuid(),job_id uuid not null,token text not null,opted_out_at timestamptz,created_at timestamptz not null default now());
    CREATE TABLE job_assignments(id uuid primary key default gen_random_uuid(),job_id uuid not null REFERENCES jobs(id),user_id uuid not null REFERENCES profiles(id),role text not null,business_id uuid REFERENCES businesses(id),active boolean not null default true,assigned_by uuid REFERENCES profiles(id),assigned_at timestamptz not null default now(),ended_at timestamptz,end_reason text);
    CREATE UNIQUE INDEX job_assignments_active_uq ON job_assignments(job_id,role) WHERE active;
    CREATE TABLE workflow_events(id uuid primary key default gen_random_uuid(),job_id uuid REFERENCES jobs(id),actor_id uuid REFERENCES profiles(id),event_type text not null,summary text not null,details jsonb,internal boolean default true,CONSTRAINT workflow_events_job_required CHECK (job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched','email_unmatched_dismissed','email_new_sender_replied','email_nojob_ai_draft','email_nojob_reply_sent','email_nojob_ai_draft_closed','email_nojob_followup_claim','email_nojob_followup_failed','email_nojob_ai_draft_failed'])));
    CREATE TABLE admin_config_events(id uuid primary key default gen_random_uuid(),actor_id uuid,event_type text not null,summary text not null,details jsonb not null,created_at timestamptz not null default now());
    CREATE TABLE customer_communication_templates(id uuid primary key default gen_random_uuid(),template_key text not null,version text not null,subject text not null,body_markdown text not null,status text not null default 'draft' CHECK(status IN ('draft','approved','superseded')),regulated_copy_locked boolean not null default false,source_note text,created_by uuid not null REFERENCES auth.users(id),created_at timestamptz not null default now(),approved_by uuid REFERENCES auth.users(id),approved_at timestamptz,UNIQUE(template_key,version));
    CREATE TABLE customer_email_sends(id uuid primary key default gen_random_uuid(),job_id uuid not null REFERENCES jobs(id),purpose text not null,idempotency_key text not null unique,status text not null default 'sending' CHECK(status IN ('sending','sent','failed','delivered_unrecorded')),error text,created_at timestamptz not null default now());`);
  await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_batch.sql", "utf8"));
  await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_batch_coverage.sql", "utf8"));
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
    expect((await db.query("SELECT job_id::text,actor_id::text,event_type,details FROM workflow_events WHERE event_type='in_house_batch_sent'")).rows).toEqual([{ job_id: id(20),actor_id: id(1),event_type: "in_house_batch_sent",details: { batch_id: id(50),business_id: id(10) } }]);
    expect((await db.query("SELECT details FROM workflow_events WHERE event_type='in_house_partner_call_email_pending'")).rows).toEqual([{ details: { batch_id:id(50),business_id:id(10),partner_trading_name:"Rapid Insulation" } }]);
    expect((await db.query("SELECT * FROM customer_email_sends")).rows).toHaveLength(0);
    expect((await db.query("SELECT status FROM customer_communication_templates")).rows).toEqual([{ status: "draft" }]);
    expect(await send(db)).toEqual({ sent: false,reason: "Already with Rapid Insulation" });
    expect((await db.query("SELECT * FROM job_assignments")).rows).toHaveLength(2);
    expect((await db.query("SELECT * FROM in_house_batches")).rows).toHaveLength(1);
  } finally { await db.close(); }
});
test("a changed electrician email fails closed inside the transaction", async () => {
  const db = await setup(); try {
    await db.exec(`UPDATE profiles SET email='changed@example.invalid' WHERE id='${id(3)}'`);
    expect(await send(db)).toEqual({ sent: false,reason: "Electrician Mitti access is not current" });
    expect((await db.query("SELECT * FROM job_assignments")).rows).toHaveLength(0);
  } finally { await db.close(); }
});
test("approved allocation never writes ledger and records the approved template in its pending event", async () => {
  const db = await setup(); try {
    await db.exec(`UPDATE customer_communication_templates SET status='approved',approved_by='${id(1)}',approved_at=now()`);
    expect(await send(db)).toEqual({ sent: true }); expect(await send(db)).toMatchObject({ sent: false });
    expect((await db.query("SELECT * FROM customer_email_sends")).rows).toEqual([]);
    const template=(await db.query<{id:string}>("SELECT id::text FROM customer_communication_templates")).rows[0]?.id;
    expect((await db.query("SELECT details FROM workflow_events WHERE event_type='in_house_partner_call_email_pending'")).rows).toEqual([{details:{template_id:template,batch_id:id(50),business_id:id(10),partner_trading_name:"Rapid Insulation"}}]);
    expect((await db.query("SELECT * FROM workflow_events WHERE event_type='in_house_batch_email_queued'")).rows).toEqual([]);
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
    for (const actor of [2,4]) { await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(actor)]); expect((await db.query("SELECT * FROM in_house_batches")).rows).toEqual([]); await expect(send(db,27,10,actor)).rejects.toThrow("permission denied"); }
    await db.exec("RESET ROLE");
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_batch.undo.sql","utf8"));
    expect((await db.query("SELECT * FROM customer_communication_templates")).rows).toHaveLength(0);
    expect((await db.query("SELECT to_regclass('public.in_house_batches') AS name")).rows).toEqual([{ name: null }]);
    expect((await db.query("SELECT proname FROM pg_proc WHERE proname='allocate_in_house_batch_job'")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(2);
  } finally { await db.close(); }
});
test("RPC refuses out-of-coverage with no side effects; postcode, radius and statewide each pass",async()=>{
  const db=await setup();try{
    await db.exec("UPDATE businesses SET service_postcodes='{}'");
    expect(await send(db)).toEqual({sent:false,reason:"Outside Rapid Insulation coverage"});
    expect((await db.query("SELECT * FROM job_assignments")).rows).toEqual([]);
    await db.exec("UPDATE businesses SET service_postcodes=ARRAY['3199']");
    expect(await send(db,20)).toEqual({sent:true});
    await db.exec(`UPDATE businesses SET service_postcodes='{}',coverage_lat=-38.14,coverage_lng=145.12,coverage_radius_km=5; INSERT INTO property_facts(property_id,fact_key,value,is_current) VALUES ('${id(12)}','coordinates','[145.12,-38.14]',true)`);
    expect(await send(db,21)).toEqual({sent:true});
    await db.exec("UPDATE businesses SET coverage_lat=null,covers_all_victoria=true");
    expect(await send(db,22)).toEqual({sent:true});
  }finally{await db.close();}
});
test("coverage undo restores the previously applied function body exactly",async()=>{
  const db=await setup();try{
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_batch_coverage.undo.sql","utf8"));
    const restored=(await db.query<{body:string}>("SELECT prosrc AS body FROM pg_proc WHERE proname='allocate_in_house_batch_job'")).rows[0]?.body;
    const original=readFileSync("docs/pending-migrations/2026-10-30_in_house_batch.sql","utf8").split("AS $$")[1]?.split("END $$;")[0];
    expect(restored).toBe(`${original}END `);
  }finally{await db.close();}
});
test("a downstream write failure rolls the whole job transaction back", async () => {
  const db = await setup(); try {
    await db.exec("CREATE FUNCTION reject_batch_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated audit failure'; END $$; CREATE TRIGGER reject_batch_event BEFORE INSERT ON workflow_events FOR EACH ROW EXECUTE FUNCTION reject_batch_event();");
    await expect(send(db)).rejects.toThrow("simulated audit failure");
    expect((await db.query("SELECT * FROM in_house_batches")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM job_assignments")).rows).toHaveLength(0);
    expect((await db.query("SELECT electrician_choice FROM jobs WHERE id=$1",[id(20)])).rows).toEqual([{ electrician_choice: null }]);
  } finally { await db.close(); }
});
test("allocation RPC refuses payee-only businesses without assignments or audit writes", async () => {
  const db = await setup(); try {
    await db.exec("UPDATE businesses SET in_house=false,pays_own_electricians=true");
    expect(await send(db)).toMatchObject({ sent: false });
    expect((await db.query("SELECT * FROM job_assignments")).rows).toEqual([]);
    expect((await db.query("SELECT * FROM workflow_events")).rows).toEqual([]);
  } finally { await db.close(); }
});

test("second in-house partner cannot take a job already sent to the first", async () => {
  const db = await setup(); try {
    await db.exec("UPDATE businesses SET in_house=true WHERE name='Other'");
    expect(await send(db)).toEqual({ sent: true });
    expect(await send(db,20,11)).toEqual({ sent: false, reason: "Already with Rapid Insulation" });
    expect((await db.query("SELECT * FROM job_assignments")).rows).toHaveLength(2);
    expect((await db.query("SELECT * FROM in_house_batches")).rows).toHaveLength(1);
  } finally { await db.close(); }
});
