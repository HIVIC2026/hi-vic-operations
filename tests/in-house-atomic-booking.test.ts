import {expect,test} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('pending atomic save: double click creates one booking, crew change and recorded job; outsider and stale validation write nothing',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TYPE booking_kind AS ENUM('ready_check','assessment','rectification','installation');
 CREATE TYPE job_stage AS ENUM('installation_scheduling','installation_booked');
 CREATE TABLE jobs(id uuid PRIMARY KEY,stage job_stage,updated_at timestamptz,deleted_at timestamptz,job_number text);
 CREATE TABLE businesses(id uuid PRIMARY KEY,in_house boolean,is_active boolean);
 CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean,member_role text);
 CREATE TABLE partner_workers(id uuid PRIMARY KEY,business_id uuid,profile_id uuid,full_legal_name text,trade_role text,removed_at timestamptz,approval_status text,esc_registered boolean,esc_registered_at timestamptz,licence_number text,rec_number text,licence_expires_on date,licence_verified_at timestamptz);
 CREATE TABLE job_assignments(id uuid DEFAULT gen_random_uuid(),job_id uuid,user_id uuid,business_id uuid,role text,active boolean,ended_at timestamptz,end_reason text,assigned_by uuid,booking_confirmed_at timestamptz);
 CREATE TABLE bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,kind booking_kind,status text,scheduled_start timestamptz,scheduled_end timestamptz,contractor_id uuid,assignment_id uuid,business_id uuid,booked_by uuid,notes text,created_at timestamptz DEFAULT now());
 CREATE TABLE workflow_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean,created_at timestamptz DEFAULT now());
 INSERT INTO jobs VALUES('${id(1)}','installation_scheduling','2026-11-01T00:00:00Z',null,'HV-TEST');
 INSERT INTO businesses VALUES('${id(2)}',true,true);
 INSERT INTO business_members VALUES('${id(2)}','${id(3)}',true,'business_admin'),('${id(2)}','${id(4)}',true,'business_admin');
 INSERT INTO partner_workers(id,business_id,profile_id,full_legal_name,trade_role,approval_status,esc_registered,esc_registered_at) VALUES('${id(5)}','${id(2)}','${id(6)}','New Installer','installer','approved',true,now());
 INSERT INTO job_assignments(job_id,user_id,business_id,role,active) VALUES('${id(1)}','${id(3)}','${id(2)}','installer',true);
 CREATE FUNCTION commit_guarded_stage(_job uuid,_expected job_stage,_to job_stage,_actor uuid,_summary text,_details jsonb,_next text) RETURNS boolean LANGUAGE plpgsql AS $$BEGIN UPDATE jobs SET stage=_to,updated_at=now() WHERE id=_job AND stage=_expected; RETURN FOUND;END$$;`);
 await db.exec(readFileSync('docs/pending-migrations/2026-11-01_in_house_saved_work.sql','utf8'));
 const p=[id(1),id(3),'installation','2026-11-10T22:00:00Z',id(5),'installation_scheduling','2026-11-01T00:00:00Z',null,null,JSON.stringify({lead:id(5),additional:[]}),JSON.stringify({needsVerification:[],staff:[]}),id(10)];
 const sql='SELECT commit_in_house_visit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
 await expect(db.query(sql,[...p.slice(0,1),id(9),...p.slice(2)])).rejects.toThrow('Not your in-house job');
 await expect(db.query(sql,[...p.slice(0,6),'2026-10-01T00:00:00Z',...p.slice(7)])).rejects.toThrow('changed');
 const [a,b]=await Promise.all([db.query(sql,p),db.query(sql,[p[0],id(4),...p.slice(2)])]);expect((a.rows[0] as any).result.bookingId).toBe((b.rows[0] as any).result.bookingId);
 expect((await db.query('SELECT * FROM bookings')).rows).toHaveLength(1);
 expect((await db.query("SELECT * FROM workflow_events WHERE event_type='piisa_crew_selected'")).rows).toHaveLength(1);
 expect((await db.query("SELECT * FROM workflow_events WHERE event_type='in_house_saved_work'")).rows).toHaveLength(1);
 await expect(db.query(sql,[...p.slice(0,3),'2026-11-11T22:00:00Z',...p.slice(4)])).rejects.toThrow('changed');
 }finally{await db.close();}
},30000);