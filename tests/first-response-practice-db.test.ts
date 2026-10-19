import {test,expect} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
import {FIRST_RESPONSE_PURPOSES,automaticFirstResponseBlocker} from '../src/lib/automatic-first-response.core';
import {readFileSync} from 'node:fs';
test('practice SQL: count and page IDs share confirmed-response predicate',async()=>{
 const db=new PGlite();
 await db.exec(`create table jobs(id text);create table customer_email_sends(job_id text,status text,purpose text);
 insert into jobs values ('failed'),('sending_unknown'),('irrelevant'),('confirmed'),('sending'),('delivered_unrecorded'),('held'),('blocked');`);
 for(const status of ['failed','sending_unknown','sending','delivered_unrecorded','held','blocked'])await db.query('insert into customer_email_sends values ($1,$2,$3)',[status,status,'existing_leads_launch_v1']);
 await db.exec("insert into customer_email_sends values ('irrelevant','sent','office_notification'),('confirmed','sent','existing_leads_launch_v1');");
 const q=await db.query<{ids:string[];total:number;tile:number}>(`with scope as(select id from jobs j where not exists(select 1 from customer_email_sends s where s.job_id=j.id and s.status='sent' and s.purpose=any($1::text[]))), page as(select id from scope order by id limit 50) select array(select id from page) ids,(select count(*)::int from scope) total,(select count(*)::int from scope) tile`,[[...FIRST_RESPONSE_PURPOSES]]);
 expect(q.rows[0]?.ids).toEqual(['blocked','delivered_unrecorded','failed','held','irrelevant','sending','sending_unknown']);
 expect(q.rows[0]?.total).toBe(7);expect(q.rows[0]?.tile).toBe(q.rows[0]?.total);await db.close();
});
const base={activatedAt:'2026-10-19T23:00:00Z',createdAt:'2026-10-19T23:01:00Z',held:false,confirmed:false};
test('activation required for every automatic route',()=>expect(automaticFirstResponseBlocker({...base,activatedAt:null})).toBe('Not activated'));
test('pre-activation enquiry rejected',()=>expect(automaticFirstResponseBlocker({...base,createdAt:'2026-10-19T22:59:59Z'})).toBe('Enquiry predates activation'));
test('held backlog rejected',()=>expect(automaticFirstResponseBlocker({...base,held:true})).toContain('Backlog held'));
test('confirmed response rejected',()=>expect(automaticFirstResponseBlocker({...base,confirmed:true})).toBe('Confirmed first response already sent'));
test('post-activation untouched enquiry passes preliminary gate only',()=>expect(automaticFirstResponseBlocker(base)).toBeNull());
test('page path requires explicit IDs in persisted source',()=>{
 expect(readFileSync('src/lib/enquiry-groups.server.ts','utf8')).toContain('loadEnquiryGroups(visibleIds: string[])');
 expect(readFileSync('src/lib/office-enquiry-page.server.ts','utf8')).toContain('loadEnquiryGroups(result.ids)');
});
