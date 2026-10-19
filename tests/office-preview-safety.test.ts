import { test, expect, mock } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { mediaReviewPlan } from '../src/lib/office-media-review.core';
import { automaticFirstResponseStatus } from '../src/lib/automatic-first-response.core';
import { isNewEnquiry } from '../src/lib/enquiry-groups.core';

test('null activation stays OFF even with selection enabled', () => {
 expect(automaticFirstResponseStatus(true,null)).toEqual({on:false,reason:'Not activated. No automatic first responses will be sent.'});
 expect(automaticFirstResponseStatus(false,'2026-10-19')).toMatchObject({on:false});
});
for (const status of ['failed','held','sending','sending_unknown']) test(`${status} without confirmed first response remains New`,()=>{
 expect(isNewEnquiry({lastEmail:{purpose:'existing_leads_launch_v1',status},sentPurposes:[]})).toBe(true);
});
test('confirmed first response excludes New; unrelated sent purpose does not',()=>{
 expect(isNewEnquiry({sentPurposes:['existing_leads_launch_v1']})).toBe(false);
 expect(isNewEnquiry({sentPurposes:['office_notification']})).toBe(true);
});
test('R2 or above requires a confirmed reason',()=>{
 expect(()=>mediaReviewPlan('over_r2')).toThrow();
 expect(mediaReviewPlan('over_r2','R2 confirmed')).toMatchObject({reason:'R2 confirmed',nextAction:'Ineligible review'});
});
test('practice review outcomes persist only manual audit next actions, never communications',async()=>{
 const db=new PGlite();
 await db.exec('create table reviews(outcome text,next_action text,manual_only boolean); create table communications(id int);');
 for(const o of ['no_insulation','below_r2','over_r2','unclear'] as const){
  const p=mediaReviewPlan(o,o==='over_r2'?'R2 confirmed':undefined);
  await db.query('insert into reviews values ($1,$2,$3)',[p.outcome,p.nextAction,p.manualOnly]);
 }
 const rows=await db.query<{outcome:string;next_action:string;manual_only:boolean}>('select * from reviews');
 expect(rows.rows).toHaveLength(4);
 expect(rows.rows.filter(r=>r.next_action==='Ready to offer Save My Spot').map(r=>r.outcome)).toEqual(['no_insulation','below_r2']);
 expect(rows.rows.every(r=>r.manual_only)).toBe(true);
 expect((await db.query<{n:number}>('select count(*)::int as n from communications')).rows[0]?.n).toBe(0);
 await db.close();
});
