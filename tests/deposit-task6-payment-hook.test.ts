import {beforeEach,expect,mock,test} from 'bun:test';
import {memoryPostgrest,type Tables} from './helpers/memory-postgrest';
const tables:Tables={};const admin=memoryPostgrest(tables);let paid=false;const noticeKeys=new Set<string>();let notices=0;
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:admin}));
mock.module('../src/lib/workflow.server',()=>({paymentGateActiveForJob:async()=>true,logEvent:async(job:string,_actor:unknown,event_type:string,_summary:string,details:any)=>{(tables.workflow_events??=[]).push({job_id:job,event_type,details});}}));
mock.module('../src/lib/fixes-quote-current.server',()=>({currentFixesQuote:async()=>null,FIXES_ACCEPT_LATEST:'held'}));
mock.module('../src/lib/repeat-piesa.server',()=>({repeatPiesaContext:async()=>null}));
mock.module('../src/lib/stripe.core',()=>({stripeBlocker:()=>null}));
mock.module('../src/lib/stripe.server',()=>({stripeKeyFor:()=> 'sk_test_mock'}));
mock.module('../src/lib/owner-email-triggers.server',()=>({onSafetyCheckPaid:async()=> 'mocked'}));
mock.module('../src/lib/installer-accepted-email.server',()=>({emailInstallerOnSafetyCheckPaid:async()=> 'mocked'}));
mock.module('../src/lib/autoadvance.server',()=>({autoAdvanceJob:async()=>{}}));
mock.module('../src/lib/deposit-request.server',()=>({notifyInstallerDepositPaid:async(job:string)=>{
 const r=tables.workflow_events?.find(r=>r.job_id===job&&r.event_type==='install_deposit_received');
 if(!r)throw Error('receipt must exist first');const key=r.details.invoice_id;
 if(!noticeKeys.has(key)){noticeKeys.add(key);notices++;}
}}));
const {afterPaymentsChanged}=await import('../src/lib/payments.server');
beforeEach(()=>{for(const k of Object.keys(tables))delete tables[k];paid=false;notices=0;noticeKeys.clear();
 tables.jobs=[{id:'j',job_number:'HV-TEST',stage:'installation_scheduling',source:'qa_test'}];
 tables.quotes=[{id:'q',accepted_at:'2026-11-01T00:00:00Z',customer_total_inc_gst:4000}];
 tables.invoices=[{id:'i',job_id:'j',kind:'installation',quote_id:'q',total_inc_gst:4000,total_paid:349,deposit_amount:365.1,created_at:'2026-11-01T00:00:00Z'}];
 tables.workflow_settings=[{id:1,safety_check_payment_inc_gst:349}];tables.piesa_records=[{job_id:'j',is_current:true,outcome:'pass'}];tables.workflow_events=[];tables.bookings=[];tables.payment_overrides=[];tables.quote_items=[];
});
for(const source of ['stripe','xero'])test(`${source} receipt uses shared payment hook, records deposit before notice and replay is once`,async()=>{
 const inv=tables.invoices?.[0];if(inv)inv.total_paid=714.1;
 tables.workflow_events?.push({id:'receipt',job_id:'j',event_type:'owner_payment_recorded',created_at:'2026-11-01T00:00:00Z',details:{invoice_id:'i',source,amount_cents:71410,paid_at:'2026-11-01T00:00:00Z',receipt_key:`${source}:receipt`}});
 await afterPaymentsChanged('j','i',null);await afterPaymentsChanged('j','i',null);
 expect(notices).toBe(1);expect(tables.workflow_events?.filter(r=>r.event_type==='install_deposit_received')).toHaveLength(1);
});
test('unpaid deposit never calls the paid notice',async()=>{
 await afterPaymentsChanged('j','i',null);expect(notices).toBe(0);
});