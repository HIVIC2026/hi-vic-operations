import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE TABLE user_roles(user_id uuid,role text); INSERT INTO user_roles VALUES ('${id(1)}','admin');
  CREATE TABLE partner_workers(id uuid PRIMARY KEY,business_id uuid,profile_id uuid,full_legal_name text,trade_role text,licence_number text,licence_expires_on date,approval_status text,removed_at timestamptz);
  INSERT INTO partner_workers VALUES ('${id(4)}','${id(10)}','${id(3)}','Example Electrician','electrician','A123','2099-01-01','approved',null);
  CREATE TABLE admin_config_events(actor_id uuid,event_type text,summary text,details jsonb);
  CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean); INSERT INTO business_members VALUES ('${id(10)}','${id(2)}',true),('${id(10)}','${id(3)}',true),('${id(11)}','${id(5)}',true);
  CREATE TABLE businesses(id uuid,in_house boolean,is_active boolean); INSERT INTO businesses VALUES ('${id(10)}',true,true);
  CREATE TABLE jobs(id uuid PRIMARY KEY,deleted_at timestamptz,electrician_choice text); INSERT INTO jobs(id) VALUES ('${id(20)}');
  CREATE TABLE job_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,user_id uuid,business_id uuid,role text,active boolean,assigned_by uuid,ended_at timestamptz,end_reason text);
  CREATE UNIQUE INDEX active_job_role ON job_assignments(job_id,role) WHERE active;
  INSERT INTO job_assignments(job_id,user_id,business_id,role,active) VALUES ('${id(20)}','${id(2)}','${id(10)}','installer',true);
  CREATE TABLE workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean);
  GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON user_roles TO authenticated;
  CREATE FUNCTION allocate_in_house_batch_job(_batch uuid,_business uuid,_job uuid,_actor uuid,_installer uuid,_electrician uuid) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN '{}'::jsonb; END $$;`);
  // Column/security/assignment migration is separable from the batch-function delta.
  const sql = readFileSync("docs/pending-migrations/2026-11-01_in_house_electrician.sql","utf8").split("-- Batch handoff no longer chooses an electrician.")[0];
  await db.exec(sql); return db;
}
const verify = (db: PGlite, actor = 1) => db.query("SELECT verify_team_electrician($1,$2,$3,$4,$5)",[id(4),"A123","REC456","2099-01-01",id(actor)]);
const allocate = (db: PGlite, actor = 2, worker = 4) => db.query("SELECT allocate_team_electrician($1,$2,$3)",[id(20),id(actor),id(worker)]);
test("office verification stamps actor/date and audits without approval/login changes",async()=>{const db=await setup();try{
  await verify(db);
  expect((await db.query("SELECT rec_number,licence_verified_by::text,licence_verified_at IS NOT NULL AS verified,approval_status FROM partner_workers")).rows).toEqual([{rec_number:"REC456",licence_verified_by:id(1),verified:true,approval_status:"approved"}]);
  expect((await db.query("SELECT event_type,actor_id::text FROM admin_config_events")).rows).toEqual([{event_type:"electrician_licence_verified",actor_id:id(1)}]);
}finally{await db.close();}});
test("two different non-office users cannot verify or directly forge verification",async()=>{const db=await setup();try{
  for(const actor of [2,5]) { await expect(verify(db,actor)).rejects.toThrow("Office only");
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[id(actor)]);
    await expect(db.query("UPDATE partner_workers SET licence_verified_at=now(),licence_verified_by=$1 WHERE id=$2",[id(actor),id(4)])).rejects.toThrow("Office only"); }
  expect((await db.query("SELECT * FROM admin_config_events")).rows).toEqual([]);
}finally{await db.close();}});
test("unverified electrician refuses before assignment; another business actor/worker refuses",async()=>{const db=await setup();try{
  await expect(allocate(db)).rejects.toThrow("Electrician not verified"); await verify(db);
  await expect(allocate(db,5)).rejects.toThrow("This job is not assigned to your business");
  await db.query("INSERT INTO partner_workers SELECT $1,$2,profile_id,full_legal_name,trade_role,licence_number,licence_expires_on,approval_status,removed_at,rec_number,licence_verified_at,licence_verified_by FROM partner_workers",[id(6),id(11)]);
  await expect(allocate(db,2,6)).rejects.toThrow("That electrician is not on your Team");
  expect((await db.query("SELECT * FROM job_assignments WHERE role='electrician'")).rows).toEqual([]);
}finally{await db.close();}});
test("verified allocation writes one active assignment, preserves history and replays without duplicate events",async()=>{const db=await setup();try{
  await verify(db);await allocate(db);await allocate(db);
  expect((await db.query("SELECT user_id::text,business_id::text FROM job_assignments WHERE active AND role='electrician'")).rows).toEqual([{user_id:id(3),business_id:id(10)}]);
  expect((await db.query("SELECT event_type FROM workflow_events")).rows).toEqual([{event_type:"in_house_electrician_allocated"}]);
}finally{await db.close();}});