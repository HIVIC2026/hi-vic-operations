import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
async function setup() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE user_roles(user_id uuid,role text); INSERT INTO user_roles VALUES ('${id(1)}','admin'),('${id(2)}','installer'),('${id(3)}','electrician');
    CREATE TABLE jobs(id uuid primary key,source text,deleted_at timestamptz,stage text);
    INSERT INTO jobs VALUES ('${id(10)}','base44',null,'piesa_complete'),('${id(11)}','qa_test',null,'piesa_complete'),('${id(12)}','base44',now(),'piesa_complete');
    CREATE TABLE businesses(id uuid primary key,in_house boolean); INSERT INTO businesses VALUES ('${id(20)}',true),('${id(21)}',false);
    CREATE TABLE job_assignments(id uuid primary key default gen_random_uuid(),job_id uuid,role text,business_id uuid,active boolean default true,ended_at timestamptz,end_reason text);
    INSERT INTO job_assignments(job_id,role,business_id) SELECT id,'installer','${id(20)}' FROM jobs;
    INSERT INTO job_assignments(job_id,role,business_id) SELECT id,'electrician','${id(20)}' FROM jobs;
    INSERT INTO job_assignments(job_id,role,business_id) VALUES ('${id(10)}','observer','${id(21)}');
    CREATE TABLE bookings(job_id uuid,kind text,status text,scheduled_start timestamptz); INSERT INTO bookings VALUES ('${id(10)}','installation','confirmed','2026-11-09T00:00:00Z');
    CREATE TABLE workflow_events(job_id uuid NOT NULL,actor_id uuid,event_type text,summary text,details jsonb,internal boolean);
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
  await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner_pull_back.sql", "utf8"));
  return db;
}
async function pull(db: PGlite, job = 10, actor = 1, reason = "Ready Check not arranged") {
  await db.query("SELECT pull_back_in_house_job($1,$2,$3)", [id(job), reason, id(actor)]);
}
test("atomic take-back ends both assignments, preserves booking/stage and records actor/reason once", async () => {
  const db = await setup(); try {
    const bookings = (await db.query("SELECT * FROM bookings")).rows;
    await pull(db); await pull(db);
    expect((await db.query("SELECT role,active,end_reason,ended_at IS NOT NULL AS ended FROM job_assignments WHERE job_id=$1 AND role IN ('installer','electrician') ORDER BY role", [id(10)])).rows).toEqual([
      { role: "electrician", active: false, end_reason: "pulled_back", ended: true }, { role: "installer", active: false, end_reason: "pulled_back", ended: true },
    ]);
    expect((await db.query("SELECT * FROM bookings")).rows).toEqual(bookings);
    expect((await db.query("SELECT stage FROM jobs WHERE id=$1", [id(10)])).rows).toEqual([{ stage: "piesa_complete" }]);
    expect((await db.query<{ actor_id: string; event_type: string; details: { reason: string; assignment_ids: string[] } }>("SELECT * FROM workflow_events")).rows).toHaveLength(1);
    const ev = (await db.query<{ actor_id: string; event_type: string; details: { reason: string; assignment_ids: string[] } }>("SELECT * FROM workflow_events")).rows[0];
    expect(ev?.actor_id).toBe(id(1)); expect(ev?.event_type).toBe("in_house_pulled_back"); expect(ev?.details.reason).toBe("Ready Check not arranged"); expect(ev?.details.assignment_ids).toHaveLength(2);
    expect((await db.query("SELECT active FROM job_assignments WHERE role='observer'")).rows).toEqual([{ active: true }]);
  } finally { await db.close(); }
});
test("two different non-admin users cannot take back records; TEST/deleted and empty reasons refused", async () => {
  const db = await setup(); try {
    for (const actor of [2,3]) await expect(pull(db,10,actor)).rejects.toThrow("Admin only");
    for (const j of [11,12]) await expect(pull(db,j)).rejects.toThrow("Job unavailable");
    await expect(pull(db,10,1,"  ")).rejects.toThrow("Reason required");
    await db.exec("SET ROLE authenticated"); await expect(pull(db)).rejects.toThrow("permission denied"); await db.exec("RESET ROLE");
    expect((await db.query("SELECT * FROM workflow_events")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM job_assignments WHERE NOT active")).rows).toHaveLength(0);
  } finally { await db.close(); }
});
test("audit failure rolls back assignment ending; undo only removes RPC", async () => {
  const db = await setup(); try {
    await db.exec("CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failed'; END $$; CREATE TRIGGER reject_event BEFORE INSERT ON workflow_events FOR EACH ROW EXECUTE FUNCTION reject_event();");
    await expect(pull(db)).rejects.toThrow("audit failed");
    expect((await db.query("SELECT * FROM job_assignments WHERE NOT active")).rows).toHaveLength(0);
    await db.exec(readFileSync("docs/pending-migrations/2026-10-30_in_house_partner_pull_back.undo.sql", "utf8"));
    expect((await db.query("SELECT proname FROM pg_proc WHERE proname='pull_back_in_house_job'")).rows).toHaveLength(0);
    expect((await db.query("SELECT * FROM bookings")).rows).toHaveLength(1);
  } finally { await db.close(); }
});