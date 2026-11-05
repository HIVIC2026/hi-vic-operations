import {beforeEach,expect,mock,test} from 'bun:test';
import {memoryPostgrest,type Tables} from './helpers/memory-postgrest';
const tables:Tables={};const db=memoryPostgrest(tables);const tasks:(()=>Promise<unknown>)[]=[];const creates:string[]=[];
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:db}));
mock.module('../src/lib/trade-view.server',()=>({requireTradeJob:async(user:string,job:string)=>{if(job!==`job-${user}`)throw Error('Not your job');}}));
mock.module('../src/lib/own-customer-portal-ready-check.server',()=>({requirePortalReadyCheck:async(job:string,user:string)=>{if(job!==`job-${user}`)throw Error('Not your job');}}));
mock.module('../src/lib/background.server',()=>({runAfterResponse:(task:()=>Promise<unknown>)=>{tasks.push(task);return 'queue_only';}}));
mock.module('../src/lib/mitti-create.server',()=>({
 readyCheckFormFacts:async()=>({job:{channel:'installer_sourced',source:'qa_test'},installerUserId:'test-user',auditId:null,measurementComplete:false,mittiInvited:true,templateSet:true,autoSend:true,gateADone:true}),
 testAssignee:async()=>({userId:'test-user',email:'reserved@example.test',fullName:null}),
 runReadyCheckFormCreation:async(job:string)=>{if(!creates.includes(job))creates.push(job);},
}));
const {requestOwnMitti,ownMittiStatus}=await import('../src/lib/own-customer-mitti-choice.server');
beforeEach(()=>{tables.workflow_events=[];tables.ceiling_measurements=[];tasks.length=0;creates.length=0;});
test('tap records intent and returns before background provider work',async()=>{
 const result=await requestOwnMitti('job-a','a');
 expect(result.requested).toBe(true);expect(creates).toHaveLength(0);expect(tasks).toHaveLength(1);
 expect(tables.workflow_events?.[0]?.event_type).toBe('own_customer_mitti_requested');
 await tasks[0]?.();expect(creates).toEqual(['job-a']);
});
test('repeated tap retains one durable intent',async()=>{
 await requestOwnMitti('job-a','a');await requestOwnMitti('job-a','a');
 expect(tables.workflow_events).toHaveLength(1);
});
test('existing audit reused without scheduling creation',async()=>{
 tables.ceiling_measurements=[{job_id:'job-a',is_current:true,external_source:'mitti',external_id:'sim_existing'}];
 expect((await requestOwnMitti('job-a','a')).auditId).toBe('sim_existing');expect(tasks).toHaveLength(0);
});
test('saved portal path never schedules Mitti',async()=>{
 tables.workflow_events=[{job_id:'job-a',event_type:'portal_ready_check_saved'}];
 await expect(requestOwnMitti('job-a','a')).rejects.toThrow('entered in the portal');expect(tasks).toHaveLength(0);
});
test('portal save before background execution cancels pending creation',async()=>{
 await requestOwnMitti('job-a','a');tables.workflow_events?.push({job_id:'job-a',event_type:'portal_ready_check_saved'});
 await tasks[0]?.();expect(creates).toHaveLength(0);
});
test.each([['a','job-b'],['b','job-a']])('two business boundaries: %s cannot access %s',async(user,job)=>{
 await expect(requestOwnMitti(job,user)).rejects.toThrow('Not your job');
 await expect(ownMittiStatus(job,user)).rejects.toThrow('Not your job');
 expect(tables.workflow_events).toHaveLength(0);expect(tasks).toHaveLength(0);
});