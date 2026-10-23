import { expect, test } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
test('six confirmed not-sent attempts retain history, release canonical keys and audit Jo approval once', async () => {
 const db=new PGlite();
 await db.exec(`create table jobs(id uuid primary key,job_number text); create table customer_email_sends(id uuid primary key,job_id uuid,status text,provider text,provider_message_id text,sent_at timestamptz,error text,idempotency_key text unique); create table workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean);`);
 const numbers=['3127','3131','3132','3133','3135','3152','9999'];
 for(const [i,n] of numbers.entries()) {const id=`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;await db.query(`insert into jobs values($1,$2)`,[id,`HV-${n}`]);await db.query(`insert into customer_email_sends values($1,$1,'failed','not_sent',null,null,$2,$3)`,[id,'No approved Jo template applies to this enquiry — held for manual review; nothing sent.',`existing_leads_launch_v1:existing_insulation_save_spot:${id}`]);}
 const sql=readFileSync(new URL('../docs/urgent-six-recovery.sql',import.meta.url),'utf8');
 const r=await db.query(sql);expect(r.rows).toHaveLength(6);
 expect((await db.query(sql)).rows).toHaveLength(0);
 const events=await db.query<{summary:string;details:{failed_attempt:{status:string;provider:string}}}>(`select summary,details from workflow_events`);expect(events.rows).toHaveLength(6);
 for(const row of events.rows){expect(row.summary).toBe('Jo approved offering every new enquiry a spot, 23 Oct 6:13pm');expect(row.details.failed_attempt.status).toBe('failed');expect(row.details.failed_attempt.provider).toBe('not_sent');}
 expect((await db.query(`select * from customer_email_sends`)).rows).toHaveLength(7);await db.close();
});