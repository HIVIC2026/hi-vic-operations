import {beforeEach,expect,mock,test} from 'bun:test';
import {memoryPostgrest,type Tables} from './helpers/memory-postgrest';
const tables:Tables={};
const admin=memoryPostgrest(tables);
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:admin}));
const change={oldPrice:2500,newPrice:2700,reason:'More access work',replacesQuoteId:'old',at:'2026-11-05T10:00:00Z'};
mock.module('../src/lib/installer-price-change.server',()=>({pendingChangeFor:async()=>change,readPriceChange:async()=>change}));
mock.module('../src/lib/installer-intake.server',()=>({intakeSendBlockers:async()=>[]}));
mock.module('../src/lib/installer-quote.server',()=>({quoteBillingBlocker:async()=>null}));
mock.module('../src/lib/install-evidence.server',()=>({jobProductProblems:async()=>[]}));
mock.module('../src/lib/comms.server',()=>({assertCustomerDeliveryAllowed:async()=>{}}));
mock.module('../src/lib/estimatelink.server',()=>({ensureOwnerLink:async()=>true}));
mock.module('../src/lib/pilot.server',()=>({applyCobrand:async()=>{}}));
let notified=0;
mock.module('../src/lib/quote-ready-notify.server',()=>({notifyOwnerQuoteReady:async()=>{notified++;return {email:'TEST capture',sms:'blocked'};}}));
mock.module('../src/lib/installer-quote-sent.server',()=>({notifyInstallerQuoteSent:async()=>{}}));
mock.module('../src/lib/workflow.server',()=>({WorkflowError:Error,commercialBlocker:async()=>null,logEvent:async()=>{},stageEntryBlockers:async()=>[],transition:async()=>{}}));
const {releaseQuoteToOwner}=await import('../src/lib/office-quote-review.server');
beforeEach(()=>{for(const key of Object.keys(tables))delete tables[key];notified=0;
 tables['jobs']=[{id:'job',channel:'installer_sourced',stage:'awaiting_quote_acceptance',source:'TEST',deleted_at:null}];
 tables['quotes']=[{id:'old',job_id:'job',kind:'installation',status:'issued',release_state:'released',sent_at:'2026-11-05T09:00:00Z',created_at:'2026-11-05T08:00:00Z',option_code:'INSTALLER_A1'},
 {id:'new',job_id:'job',kind:'installation',status:'draft',release_state:'held',sent_at:null,created_at:'2026-11-05T10:00:01Z',release_hold_reason:'Waiting for office review before sending',option_code:'INSTALLER_A1'}];
});
test('automatic replacement refused without owner delivery or withdrawal',async()=>{
 await expect(releaseQuoteToOwner('job','new',null,'auto')).rejects.toThrow('press Send');
 expect(tables['quotes']?.[0]?.['status']).toBe('issued');expect(notified).toBe(0);
});
test('office replacement claims new send, supersedes old and notifies once',async()=>{
 await releaseQuoteToOwner('job','new','office','office');
 expect(tables['quotes']?.[0]?.['status']).toBe('superseded');
 expect(tables['quotes']?.[1]?.['status']).toBe('issued');
 expect(tables['quotes']?.[1]?.['sent_at']).not.toBeNull();expect(notified).toBe(1);
 await expect(releaseQuoteToOwner('job','new','office','office')).rejects.toThrow();expect(notified).toBe(1);
});
test('stale draft cannot send after new installer price',async()=>{
 const q=tables['quotes']?.[1];if(q)q['created_at']='2026-11-05T09:00:00Z';
 await expect(releaseQuoteToOwner('job','new','office','office')).rejects.toThrow('updated quote');
 expect(tables['quotes']?.[0]?.['status']).toBe('issued');expect(notified).toBe(0);
});
test('accepted job retains existing stage guard and signed quote',async()=>{
 const job=tables['jobs']?.[0];if(job)job['stage']='measured_quote_accepted';
 const old=tables['quotes']?.[0];if(old)old['status']='accepted';
 await expect(releaseQuoteToOwner('job','new','office','office')).rejects.toThrow('quote stage');
 expect(tables['quotes']?.[0]?.['status']).toBe('accepted');expect(notified).toBe(0);
});