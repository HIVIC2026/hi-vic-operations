import {expect,mock,test} from 'bun:test';
const events:Record<string,unknown>[]=[];const tables:string[]=[];
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:{from:(t:string)=>{tables.push(t);if(t==='jobs')return{select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:'TEST',job_number:'TEST',stage:'new_enquiry',eligibility_outcome:'needs_onsite_confirmation',eligibility_decision_source:'system'},error:null})})})};if(t==='lead_campaign_responses')return{select:()=>({eq:()=>({maybeSingle:async()=>({data:null,error:null})})})};if(t==='customer_engagement_events')return{insert:async(e:Record<string,unknown>)=>{events.push(e);return{error:null}}};throw new Error(`Forbidden test access: ${t}`)}}}));
const {reviewLeadMedia}=await import('../src/lib/enquiry-groups.server');
for(const outcome of ['no_insulation','below_r2','over_r2','unclear'] as const)test(`real review action ${outcome} writes only audit, no queue/send/job update`,async()=>{
 tables.length=0;const before=events.length;
 await reviewLeadMedia('TEST',outcome,'TEST_ACTOR',outcome==='over_r2'?'Confirmed R2 or above':undefined);
 expect(events).toHaveLength(before+1);expect(tables).toEqual(['jobs','customer_engagement_events']);
 expect(events.at(-1)?.metadata).toMatchObject({outcome,manualOnly:true});
});
test('real R2+ action without reason rejects before any persistence',async()=>{
 const n=events.length;await expect(reviewLeadMedia('TEST','over_r2','TEST_ACTOR')).rejects.toThrow();expect(events.length).toBe(n);
});
