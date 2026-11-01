import {expect,test} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id=(n:number)=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
test('pending handback permits own office only; paired release and reason once, audit failure rolls back',async()=>{const db=new PGlite();try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE TABLE user_roles(user_id uuid,role text);CREATE TABLE jobs(id uuid PRIMARY KEY,source text,deleted_at timestamptz);INSERT INTO jobs VALUES('${id(10)}','base44',null);CREATE TABLE businesses(id uuid PRIMARY KEY,in_house boolean);INSERT INTO businesses VALUES('${id(20)}',true);CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean,member_role text);INSERT INTO business_members VALUES('${id(20)}','${id(2)}',true,'business_admin'),('${id(21)}','${id(3)}',true,'business_admin');CREATE TABLE job_assignments(id uuid DEFAULT gen_random_uuid(),job_id uuid,role text,business_id uuid,active boolean,ended_at timestamptz,end_reason text);INSERT INTO job_assignments(job_id,role,business_id,active) VALUES('${id(10)}','installer','${id(20)}',true),('${id(10)}','electrician','${id(20)}',true);CREATE TABLE workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean);`);
await db.exec(readFileSync('docs/pending-migrations/2026-11-01_task7_trade_hand_back.sql','utf8'));
for(const actor of [3,4])await expect(db.query('SELECT pull_back_in_house_job($1,$2,$3)',[id(10),'Too far',id(actor)])).rejects.toThrow('Not your in-house job');
await db.exec(`CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit failed';END$$;CREATE TRIGGER bad BEFORE INSERT ON workflow_events FOR EACH ROW EXECUTE FUNCTION reject_event();`);
await expect(db.query('SELECT pull_back_in_house_job($1,$2,$3)',[id(10),'Too far',id(2)])).rejects.toThrow('audit failed');expect((await db.query('SELECT * FROM job_assignments WHERE NOT active')).rows).toHaveLength(0);await db.exec('DROP TRIGGER bad ON workflow_events');
for(let i=0;i<2;i++)await db.query('SELECT pull_back_in_house_job($1,$2,$3)',[id(10),'Too far',id(2)]);
expect((await db.query('SELECT * FROM job_assignments WHERE NOT active')).rows).toHaveLength(2);expect((await db.query('SELECT details FROM workflow_events')).rows).toEqual([{details:{reason:'Too far',business_id:id(20),assignment_ids:expect.any(Array)}}]);
}finally{await db.close();}});
