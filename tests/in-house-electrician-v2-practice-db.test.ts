// Part 6 fix wave C1: `allocate_team_electrician` v2 — electricians never log in, so a verified Team electrician with NO
// profile and NO business membership can be chosen; the assignment carries user_id NULL and the allocation event names the
// worker. Proven on PGlite over v1 (2026-11-01) and rolled back to v1.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function setup(v2 = true) {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  CREATE TABLE user_roles(user_id uuid,role text); INSERT INTO user_roles VALUES ('${id(1)}','admin');
  CREATE TABLE partner_workers(id uuid PRIMARY KEY,business_id uuid,profile_id uuid,full_legal_name text,trade_role text,licence_number text,licence_expires_on date,approval_status text,removed_at timestamptz);
  INSERT INTO partner_workers VALUES ('${id(4)}','${id(10)}',NULL,'Alex Amp','electrician','A123','2099-01-01','approved',null),('${id(6)}','${id(10)}',NULL,'Bea Bolt','electrician','B456','2099-01-01','approved',null);
  CREATE TABLE admin_config_events(actor_id uuid,event_type text,summary text,details jsonb);
  CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean); INSERT INTO business_members VALUES ('${id(10)}','${id(2)}',true);
  CREATE TABLE businesses(id uuid,in_house boolean,is_active boolean); INSERT INTO businesses VALUES ('${id(10)}',true,true);
  CREATE TABLE jobs(id uuid PRIMARY KEY,deleted_at timestamptz,electrician_choice text); INSERT INTO jobs(id) VALUES ('${id(20)}');
  CREATE TABLE job_assignments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,user_id uuid,business_id uuid,role text,active boolean,assigned_by uuid,ended_at timestamptz,end_reason text);
  CREATE UNIQUE INDEX active_job_role ON job_assignments(job_id,role) WHERE active;
  INSERT INTO job_assignments(job_id,user_id,business_id,role,active) VALUES ('${id(20)}','${id(2)}','${id(10)}','installer',true);
  CREATE TABLE workflow_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean,created_at timestamptz NOT NULL DEFAULT now());
  GRANT USAGE ON SCHEMA public,auth TO authenticated; GRANT SELECT ON user_roles TO authenticated;
  CREATE FUNCTION allocate_in_house_batch_job(_batch uuid,_business uuid,_job uuid,_actor uuid,_installer uuid,_electrician uuid) RETURNS jsonb LANGUAGE plpgsql AS $$ BEGIN RETURN '{}'::jsonb; END $$;`);
  await db.exec(readFileSync("docs/pending-migrations/2026-11-01_in_house_electrician.sql", "utf8").split("-- Batch handoff no longer chooses an electrician.")[0]!);
  if (v2) await db.exec(readFileSync("docs/pending-migrations/2026-11-03_allocate_team_electrician_v2.sql", "utf8"));
  for (const [w, lic] of [[4, "A123"], [6, "B456"]] as const) await db.query("SELECT verify_team_electrician($1,$2,$3,$4,$5)", [id(w), lic, "REC456", "2099-01-01", id(1)]);
  return db;
}
const allocate = (db: PGlite, worker = 4, actor = 2) => db.query<{ allocate_team_electrician: { already_allocated: boolean } }>("SELECT allocate_team_electrician($1,$2,$3)", [id(20), id(actor), id(worker)]);
const assignments = (db: PGlite) => db.query("SELECT user_id::text,business_id::text,active,end_reason FROM job_assignments WHERE role='electrician' ORDER BY active DESC, ended_at NULLS LAST");

test("v1 (today): a verified electrician with no profile is refused — nothing can be allocated, no link ever minted", async () => {
  const db = await setup(false);
  try { await expect(allocate(db)).rejects.toThrow("Electrician needs active Team access"); } finally { await db.close(); }
});
test("v2: no profile and no membership → one active assignment with user_id NULL, the event names the worker; the actor still needs membership", async () => {
  const db = await setup();
  try {
    expect((await allocate(db)).rows[0]!.allocate_team_electrician).toEqual({ already_allocated: false });
    expect((await assignments(db)).rows).toEqual([{ user_id: null, business_id: id(10), active: true, end_reason: null }]);
    expect((await db.query("SELECT event_type, details->>'worker_id' AS worker FROM workflow_events")).rows).toEqual([{ event_type: "in_house_electrician_allocated", worker: id(4) }]);
    await expect(allocate(db, 4, 5)).rejects.toThrow("This job is not assigned to your business");
  } finally { await db.close(); }
});
test("v2: the same worker again is already_allocated (no second row or event); the other worker (also no profile) replaces them and ends the old assignment", async () => {
  const db = await setup();
  try {
    await allocate(db);
    expect((await allocate(db)).rows[0]!.allocate_team_electrician).toEqual({ already_allocated: true });
    expect((await db.query("SELECT count(*)::int AS n FROM workflow_events")).rows).toEqual([{ n: 1 }]);
    expect((await allocate(db, 6)).rows[0]!.allocate_team_electrician).toEqual({ already_allocated: false });
    expect((await assignments(db)).rows).toEqual([{ user_id: null, business_id: id(10), active: true, end_reason: null }, { user_id: null, business_id: id(10), active: false, end_reason: "Team electrician changed" }]);
    expect((await db.query("SELECT details->>'worker_id' AS worker FROM workflow_events ORDER BY created_at")).rows).toEqual([{ worker: id(4) }, { worker: id(6) }]);
  } finally { await db.close(); }
});
test("v2 keeps every other guard: unverified, another business's worker, deleted job", async () => {
  const db = await setup();
  try {
    await db.query("UPDATE partner_workers SET licence_expires_on='2000-01-01' WHERE id=$1", [id(6)]);
    await expect(allocate(db, 6)).rejects.toThrow("Electrician not verified");
    await db.query("INSERT INTO partner_workers(id,business_id,profile_id,full_legal_name,trade_role,licence_number,licence_expires_on,approval_status) VALUES ($1,$2,NULL,'Other','electrician','C1','2099-01-01','approved')", [id(7), id(11)]);
    await expect(allocate(db, 7)).rejects.toThrow("That electrician is not on your Team");
    await db.query("UPDATE jobs SET deleted_at=now()");
    await expect(allocate(db)).rejects.toThrow("Job unavailable");
  } finally { await db.close(); }
});
test("rollback restores v1 exactly (the no-profile refusal returns)", async () => {
  const db = await setup();
  try {
    await db.exec(readFileSync("docs/pending-migrations/2026-11-03_allocate_team_electrician_v2_rollback.sql", "utf8"));
    await expect(allocate(db)).rejects.toThrow("Electrician needs active Team access");
  } finally { await db.close(); }
});
