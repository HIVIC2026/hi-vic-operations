import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
/** Execute the pending transaction in a disposable practice database, never a hosted client. */
export async function practiceHandback(reason:string,ownOffice:boolean){
 const db=new PGlite();const job='00000000-0000-4000-8000-000000000001',biz='00000000-0000-4000-8000-000000000002',actor='00000000-0000-4000-8000-000000000003';
 try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE user_roles(user_id uuid,role text);CREATE TABLE jobs(id uuid PRIMARY KEY,source text,deleted_at timestamptz);
 CREATE TABLE businesses(id uuid PRIMARY KEY,in_house boolean);CREATE TABLE business_members(business_id uuid,user_id uuid,active boolean,member_role text);
 CREATE TABLE job_assignments(id uuid DEFAULT gen_random_uuid(),job_id uuid,role text,business_id uuid,active boolean,ended_at timestamptz,end_reason text);
 CREATE TABLE workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean);
 INSERT INTO jobs VALUES('${job}','base44',null);INSERT INTO businesses VALUES('${biz}',true);
 INSERT INTO job_assignments(job_id,role,business_id,active) VALUES('${job}','installer','${biz}',true),('${job}','electrician','${biz}',true);`);
 if(ownOffice)await db.query("INSERT INTO business_members VALUES($1,$2,true,'business_admin')",[biz,actor]);
 await db.exec(readFileSync('docs/pending-migrations/2026-11-01_task7_trade_hand_back.sql','utf8'));
 await db.query('SELECT pull_back_in_house_job($1,$2,$3)',[job,reason,actor]);
 return{assignments:(await db.query<{role:string;active:boolean}>('SELECT role,active FROM job_assignments ORDER BY role')).rows,events:(await db.query<{event_type:string;details:{reason:string}}>('SELECT event_type,details FROM workflow_events')).rows};
 }finally{await db.close();}
}
