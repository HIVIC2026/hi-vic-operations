import {beforeEach,expect,mock,test} from 'bun:test';
import {memoryPostgrest,type Tables} from './helpers/memory-postgrest';
const tables:Tables={};const db=memoryPostgrest(tables);
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:db}));
mock.module('../src/lib/trade-view.server',()=>({requireTradeJob:async(userId:string,jobId:string)=>{
 const job=tables.jobs?.find(j=>j.id===jobId);
 if(!tables.business_members?.some(m=>m.user_id===userId&&m.business_id===job?.business_id&&m.active))throw Error('Not your job.');
 return {kind:'installer'};
}}));
mock.module('../src/lib/installer-price.server',()=>({readInstallerPrice:async(jobId:string)=>tables.workflow_events?.find(e=>e.job_id===jobId)?.details??null}));
const {readPortalReadyCheck}=await import('../src/lib/own-customer-portal-ready-check.server');
beforeEach(()=>{
 tables.jobs=[{id:'job-a',business_id:'biz-a'},{id:'job-b',business_id:'biz-b'}];
 tables.business_members=[{user_id:'boss-a',business_id:'biz-a',active:true},{user_id:'boss-b',business_id:'biz-b',active:true}];
 tables.ceiling_measurements=['a','b'].map(k=>({job_id:`job-${k}`,is_current:true,external_source:'portal_ready_check',raw_snapshot:[{label:'Install m²',value:k==='a'?'120':'150'}]}));
 tables.workflow_events=['a','b'].map(k=>({job_id:`job-${k}`,details:{sendToQuote:true,setAt:'2026-11-05T09:00:00Z'}}));
});
test('first user sees own submitted details, never second user details',async()=>{
 expect((await readPortalReadyCheck('job-a','boss-a')).entries[0]?.value).toBe('120');
 await expect(readPortalReadyCheck('job-b','boss-a')).rejects.toThrow('Not your job');
});
test('second user sees own submitted details, never first user details',async()=>{
 expect((await readPortalReadyCheck('job-b','boss-b')).entries[0]?.value).toBe('150');
 await expect(readPortalReadyCheck('job-a','boss-b')).rejects.toThrow('Not your job');
});
test('an unsent draft cannot be shown as submitted Ready Check',async()=>{
 if(tables.workflow_events?.[0])tables.workflow_events[0].details.sendToQuote=false;
 await expect(readPortalReadyCheck('job-a','boss-a')).rejects.toThrow('not been sent');
});