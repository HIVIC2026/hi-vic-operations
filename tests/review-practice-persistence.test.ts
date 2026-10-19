import {test,expect,mock} from 'bun:test';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
await db.exec('create table reviews(metadata jsonb);create table customer_email_sends(id int);create table job_communications(id int);create table post_intake_work(id int);');
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(t:string)=>{
 if(t==='jobs')return{select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'TEST',stage:'new_enquiry',eligibility_outcome:'needs_onsite_confirmation',eligibility_decision_source:'system'},error:null})})})};
 if(t==='customer_engagement_events')return{insert:async(e:{metadata:unknown})=>{await db.query('insert into reviews values($1)',[JSON.stringify(e.metadata)]);return{error:null}}};
 throw new Error(`Forbidden review persistence ${t}`);
}}}));
const {reviewLeadMedia}=await import('../src/lib/enquiry-groups.server');
test('actual review helper stores four manual next actions on practice DB with zero communications/queue rows',async()=>{
 for(const o of ['no_insulation','below_r2','over_r2','unclear'] as const)await reviewLeadMedia('TEST',o,'TEST',o==='over_r2'?'R2 confirmed':undefined);
 const rows=await db.query<{action:string;manual:boolean}>("select metadata->>'nextAction' action,(metadata->>'manualOnly')::boolean manual from reviews");
 expect(rows.rows.map(r=>r.action)).toEqual(['Offer Save My Spot','Offer Save My Spot','Send ineligible response','Request more photos']);expect(rows.rows.every(r=>r.manual)).toBe(true);
 for(const t of ['customer_email_sends','job_communications','post_intake_work'])expect((await db.query<{n:number}>(`select count(*)::int n from ${t}`)).rows[0]?.n).toBe(0);
 await db.close();
});
