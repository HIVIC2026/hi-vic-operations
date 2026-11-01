import {expect,test} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {paymentPlan,paymentSteps,installDepositBlocker} from '../src/lib/payments.core';
import {ownerPiesaConfirmationBlocker} from '../src/lib/piesa-owner-confirm.core';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('real stage SQL: atomic clicks and ESC refusal work, but canonical unpaid/unsigned blockers are NOT enforced by pending writer',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TYPE booking_kind AS ENUM('ready_check','assessment','rectification','installation');
 CREATE TYPE job_stage AS ENUM('installation_scheduling','installation_booked','cancelled','complete','on_hold');
 CREATE TABLE jobs(id uuid PRIMARY KEY,stage job_stage,updated_at timestamptz,deleted_at timestamptz,job_number text,next_action text,last_activity_at timestamptz,prior_stage job_stage,hold_reason text,cancelled_reason text);
 CREATE TABLE user_roles(user_id uuid,role text);
 CREATE TABLE businesses(id uuid PRIMARY KEY,in_house boolean,is_active boolean);
 CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean,member_role text);
 CREATE TABLE partner_workers(id uuid PRIMARY KEY,business_id uuid,profile_id uuid,full_legal_name text,trade_role text,removed_at timestamptz,approval_status text,esc_registered boolean,esc_registered_at timestamptz,licence_number text,rec_number text,licence_expires_on date,licence_verified_at timestamptz);
 CREATE TABLE job_assignments(id uuid DEFAULT gen_random_uuid(),job_id uuid,user_id uuid,business_id uuid,role text,active boolean,ended_at timestamptz,end_reason text,assigned_by uuid,booking_confirmed_at timestamptz);
 CREATE TABLE bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,kind booking_kind,status text,scheduled_start timestamptz,scheduled_end timestamptz,contractor_id uuid,assignment_id uuid,business_id uuid,booked_by uuid,notes text,created_at timestamptz DEFAULT now());
 CREATE TABLE workflow_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean,created_at timestamptz DEFAULT now(),from_stage job_stage,to_stage job_stage);
 CREATE TABLE partner_worker_certifications(id uuid,worker_id uuid,status text);
 CREATE TABLE worker_certification_levels(certification_id uuid,recorded_at timestamptz);
 CREATE TABLE admin_config_events(id uuid,details jsonb);
 CREATE TABLE partner_activations(application_id uuid,business_id uuid);
 CREATE TABLE rec_onboarding_applications(id uuid,data jsonb);
 INSERT INTO jobs(id,stage,updated_at,deleted_at,job_number) VALUES('${id(1)}','installation_scheduling','2026-11-01T00:00:00Z',null,'HV-TEST');
 INSERT INTO businesses VALUES('${id(2)}',true,true);
 INSERT INTO business_members VALUES('${id(2)}','${id(3)}',true,'business_admin'),('${id(2)}','${id(4)}',true,'business_admin');
 INSERT INTO partner_workers(id,business_id,profile_id,full_legal_name,trade_role,approval_status,esc_registered,esc_registered_at) VALUES('${id(5)}','${id(2)}','${id(6)}','New Installer','installer','approved',true,now());
 INSERT INTO job_assignments(job_id,user_id,business_id,role,active) VALUES('${id(1)}','${id(3)}','${id(2)}','installer',true);
 `);
 // Real production stage writer, not a permissive test replacement.
 await db.exec(readFileSync('drizzle/migrations/0073_guarded_stage_commit.sql','utf8'));
 await db.exec(readFileSync('docs/pending-migrations/2026-11-01_in_house_saved_work.sql','utf8'));
 const revision=(await db.query('SELECT in_house_visit_revision($1) AS revision',[id(1)])).rows[0] as any;
 const p=[id(1),id(3),'installation','2026-11-10T22:00:00Z',id(5),'installation_scheduling','2026-11-01T00:00:00Z',null,null,JSON.stringify({lead:id(5),additional:[]}),JSON.stringify({needsVerification:[],staff:[],revision:revision.revision}),id(10)];
 const sql='SELECT commit_in_house_visit($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) AS result';
 await db.exec(`UPDATE partner_workers SET esc_registered=false WHERE id='${id(5)}'`);
 const missingEsc=(await db.query('SELECT in_house_visit_revision($1) AS revision',[id(1)])).rows[0] as any;
 await expect(db.query(sql,[...p.slice(0,10),JSON.stringify({revision:missingEsc.revision}),p[11]])).rejects.toThrow('ESC-registered');
 expect((await db.query('SELECT * FROM bookings')).rows).toHaveLength(0);
 expect((await db.query('SELECT * FROM workflow_events')).rows).toHaveLength(0);
 await db.exec(`UPDATE partner_workers SET esc_registered=true WHERE id='${id(5)}'`);
 await expect(db.query(sql,[...p.slice(0,1),id(9),...p.slice(2)])).rejects.toThrow('Not your in-house job');
 await expect(db.query(sql,[...p.slice(0,6),'2026-10-01T00:00:00Z',...p.slice(7)])).rejects.toThrow('changed');
 // Actual canonical cores expose why a real stage writer is NOT sufficient.
 // No invoice/signature is seeded: these are diagnostic gap assertions, not gate-parity PASS.
 const plan=paymentPlan({quoteTotalCents:134900,safetyCheckCents:34900});
 expect(plan.installDepositCents).toBe(10000);
 expect(installDepositBlocker(plan,paymentSteps(plan,{install:34900,fixes:0,repeat:0},{},'2026-11-01T00:00:00Z'))).not.toBeNull();
 expect(ownerPiesaConfirmationBlocker({piesaRecordId:id(30),confirmation:null})).not.toBeNull();
 // Changes to independent money/owner rows are invisible to the current revision.
 await db.exec(`CREATE TABLE diagnostic_gate_inputs(invoice_paid_cents integer,owner_signed boolean); INSERT INTO diagnostic_gate_inputs VALUES(44900,true); UPDATE diagnostic_gate_inputs SET invoice_paid_cents=34900,owner_signed=false;`);
 expect((await db.query('SELECT in_house_visit_revision($1) AS revision',[id(1)])).rows[0]).toEqual(revision);
 const [a,b]=await Promise.all([db.query(sql,p),db.query(sql,[p[0],id(4),...p.slice(2)])]);expect((a.rows[0] as any).result.bookingId).toBe((b.rows[0] as any).result.bookingId);
 expect((await db.query('SELECT * FROM bookings')).rows).toHaveLength(1);
 // This booking succeeded despite the canonical core blockers above: intentional
 // evidence of the unresolved B gap, NEVER a claim that this migration is ready.
 expect((await db.query("SELECT * FROM workflow_events WHERE event_type='piisa_crew_selected'")).rows).toHaveLength(1);
 expect((await db.query("SELECT * FROM workflow_events WHERE event_type='in_house_saved_work'")).rows).toHaveLength(1);
 await expect(db.query(sql,[...p.slice(0,3),'2026-11-11T22:00:00Z',...p.slice(4)])).rejects.toThrow('changed');
 const snapshot=(await db.query('SELECT updated_at FROM jobs WHERE id=$1',[id(1)])).rows[0] as any;
 const currentCrew=(await db.query("SELECT id FROM workflow_events WHERE event_type='piisa_crew_selected' ORDER BY created_at DESC LIMIT 1")).rows[0] as any;
 const book=(a.rows[0] as any).result.bookingId;
 await db.exec(`INSERT INTO partner_workers(id,business_id,profile_id,full_legal_name,trade_role,approval_status,esc_registered,esc_registered_at) VALUES('${id(7)}','${id(2)}','${id(8)}','Replacement Installer','installer','approved',true,now())`);
 const rev2=(await db.query('SELECT in_house_visit_revision($1) AS revision',[id(1)])).rows[0] as any;
 const swap=[id(1),id(3),'crew',null,id(7),'installation_booked',snapshot.updated_at,book,currentCrew.id,JSON.stringify({lead:id(7),additional:[]}),JSON.stringify({revision:rev2.revision}),id(11)];
 await Promise.all([db.query(sql,swap),db.query(sql,[swap[0],id(4),...swap.slice(2)])]);
 expect((await db.query("SELECT * FROM workflow_events WHERE event_type='in_house_lead_changed'")).rows).toHaveLength(1);
 expect((await db.query('SELECT * FROM bookings')).rows).toHaveLength(1);
 const c=(await db.query('SELECT claim_in_house_saved_work($1,$2,now()) AS claimed',[id(11),id(20)])).rows[0] as any;
 const again=(await db.query('SELECT claim_in_house_saved_work($1,$2,now()) AS claimed',[id(11),id(21)])).rows[0] as any;
 expect(c.claimed).toBe(true);expect(again.claimed).toBe(false);
 }finally{await db.close();}
},30000);