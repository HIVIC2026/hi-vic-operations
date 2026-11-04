import { beforeEach, expect, mock, test } from 'bun:test';
import { memoryPostgrest, type Tables } from './helpers/memory-postgrest';
const tables:Tables={};const admin=memoryPostgrest(tables);
let cleared=true,basis='initial_piesa',paid=false,failed=false,held=true,paused=false,invoiceMissing=false,invoiceReadFails=false,officeOutcome='sent';
const emails:any[]=[],texts:any[]=[],offices:any[]=[];
const emailKeys=new Set<string>(),smsKeys=new Set<string>();
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:admin}));
mock.module('../src/lib/in-house-suppression.server',()=>({readInHouseDispatchState:async()=>({failed,held:new Set(held?['j']:[])}),inHouseDispatchSkip:async()=>failed?'in_house_read_failed':held?'in_house':null}));
mock.module('../src/lib/install-days.server',()=>({installDayContext:async()=>({clearance:{cleared,basis},deadline:'2026-11-30',booked:false})}));
mock.module('../src/lib/payments.server',()=>({jobPaymentView:async()=>{if(invoiceReadFails)throw Error('read failed');return invoiceMissing?null:({invoiceId:'i',invoices:{install:{id:'i',xero_invoice_id:'x'}},plan:{installDepositCents:36510},steps:[{key:'install_deposit',state:paid?'paid':'due',outstandingCents:paid?0:36510}],bank:{configured:true,accountName:'Practice',bsb:'123456',accountNumber:'12345678'},reference:'INV-1',stripe:{available:true}});}}));
mock.module('../src/lib/veec-copy-email.server',()=>({ownerMyJobLink:async()=> 'https://example.invalid/my-job/token'}));
// Faithful stand-in: the REAL consentAllowsDelivery against the latest owner_contact_consents row (fix wave I1).
mock.module('../src/lib/comms.server',()=>({assertCustomerDeliveryAllowed:async(jobId:string,what:string,purpose?:string)=>{
 if(paused)throw Error('held');
 const {consentAllowsDelivery}=await import('../src/lib/do-not-contact.core');
 const latest=(tables.owner_contact_consents??[]).filter(c=>c.job_id===jobId).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)))[0]??null;
 if(purpose&&consentAllowsDelivery(latest,purpose))return;
 if(latest?.consent_status!=='granted')throw Error(`Owner contact consent missing (${what})`);
}}));
mock.module('../src/lib/trade-pause.server',()=>({tradeMessagesPausedNow:async()=>paused?'paused':null}));
mock.module('../src/lib/qa-inbox.server',()=>({qaDeliveryHeld:async()=>false}));
mock.module('../src/lib/owner-email-send.server',()=>({sendGuardedOwnerEmail:async(p:any)=>{if(emailKeys.has(p.key))return 'already attempted';emailKeys.add(p.key);emails.push({...p,mail:p.build(null)});return 'sent';}}));
mock.module('../src/lib/sms.server',()=>({sendRealSms:async(p:any)=>{if(smsKeys.has(p.idempotencyKey))return{status:'already'};smsKeys.add(p.idempotencyKey);texts.push(p);return {status:'sent'};}}));
mock.module('../src/lib/office-email.server',()=>({sendOfficeEmail:async(p:any)=>{offices.push(p);return{status:officeOutcome,detail:officeOutcome==='failed'?"The email service didn't accept it":'mock'};}}));
const dr=await import('../src/lib/deposit-request.server');
// Task 6 behaviour with the clear-to-install / upgrades-needed emails OFF (they are ON since go-live 5 Nov 2026; the ON path has its own tests).
const legacy=()=>({...dr.defaultClearToInstallDeps(),approved:false,upgradesApproved:false});
type Deps=ReturnType<typeof legacy>;
const requestInstallDeposit=(j:string,now?:Date,deps?:Deps)=>dr.requestInstallDeposit(j,now,deps??legacy());
const sweepDepositRequests=(now?:Date,deps?:Deps)=>dr.sweepDepositRequests(now,deps??legacy());
const notifyInstallerDepositPaid=(j:string,now?:Date,deps?:Deps)=>dr.notifyInstallerDepositPaid(j,now,deps??legacy());
beforeEach(()=>{
 for(const k of Object.keys(tables))delete tables[k];
 tables.jobs=[{id:'j',job_number:'HV-1234',source:'website',stage:'installation_scheduling',owner_id:'o',property_id:'p',deleted_at:null,qa_archived_at:null}];
 tables.owners=[{id:'o',full_name:'Jo Owner',email:'owner@example.invalid',phone:'0412345678'}];
 tables.properties=[{id:'p',address_line:'1 Practice St',suburb:'Melbourne',postcode:'3000'}];
 tables.businesses=[{id:'b',name:'Practice Insulation',email:'office@example.invalid',in_house:true}];
 tables.job_assignments=[{id:'a',job_id:'j',business_id:'b',user_id:'u',role:'installer',active:true}];
 tables.workflow_events=[];tables.customer_email_sends=[];
 // Task 2 (Jo answer 21): eligibility reads the recorded PIESA result (piesa_records), not the clearance basis.
 tables.piesa_records=[{id:'pr',job_id:'j',kind:'initial',outcome:'pass',is_current:true,completed_date:'2026-10-30',signed_off_by:'e',created_at:'2026-10-30T00:00:00Z'}];
 tables.quotes=[];tables.rectification_items=[];
 tables.owner_contact_consents=[{id:'c1',job_id:'j',consent_status:'granted',source:'website',created_at:'2026-10-01T00:00:00Z'}];
 emails.length=texts.length=offices.length=0;emailKeys.clear();smsKeys.clear();cleared=held=true;basis='initial_piesa';paid=failed=paused=false;
 invoiceMissing=invoiceReadFails=false;officeOutcome='sent';
});
test('pass requests one owner email and link-free text, replay sends neither again',async()=>{
 await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));
 expect(emails).toHaveLength(1);expect(texts).toHaveLength(1);expect(emails[0].key).toBe('install-deposit:v1:i');expect(offices).toHaveLength(0);
 expect(texts[0].body).not.toMatch(/https?:|www\./);expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(1);
});
test('no recorded PIESA result requests nothing; the result recorded later requests once',async()=>{
 tables.piesa_records=[];cleared=false;await requestInstallDeposit('j');expect(emails.length+texts.length).toBe(0);
 tables.piesa_records=[{id:'pr',job_id:'j',kind:'initial',outcome:'pass',is_current:true,completed_date:'2026-10-30',signed_off_by:'e',created_at:'2026-10-30T00:00:00Z'}];
 cleared=true;basis='section_c';await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));expect(emails).toHaveLength(1);
});
test('recorded request gets day 3/day 7 once, none after paid',async()=>{
 await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));
 await sweepDepositRequests(new Date('2026-11-04T00:00:00Z'));await sweepDepositRequests(new Date('2026-11-04T00:00:00Z'));
 await sweepDepositRequests(new Date('2026-11-08T00:00:00Z'));expect(emails).toHaveLength(3);expect(texts).toHaveLength(3);
 paid=true;tables.workflow_events?.push({job_id:'j',event_type:'install_deposit_received',created_at:'2026-11-09T00:00:00Z',details:{invoice_id:'i'}});await sweepDepositRequests(new Date('2026-11-09T00:00:00Z'));expect(emails).toHaveLength(4);expect(texts).toHaveLength(3);expect(offices).toHaveLength(1);
});
for(const source of ['stripe','xero'])test(`${source} confirmed deposit tells owner and installer office once, never texts office`,async()=>{
 paid=true;tables.workflow_events?.push({job_id:'j',event_type:'install_deposit_received',created_at:'2026-11-01T00:00:00Z',details:{invoice_id:'i',source}});
 await notifyInstallerDepositPaid('j',new Date('2026-11-01T00:00:00Z'));await notifyInstallerDepositPaid('j',new Date('2026-11-01T00:00:00Z'));
 expect(emails).toHaveLength(1);expect(offices).toHaveLength(1);expect(offices[0].to).toBe('office@example.invalid');expect(texts).toHaveLength(0);
});
test('failed in-house lookup preserves intent without sends; non-in-house jobs do not send',async()=>{
 failed=true;await requestInstallDeposit('j');failed=false;held=false;await requestInstallDeposit('j');expect(emails.length+texts.length).toBe(0);expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_request_pending')).toHaveLength(1);
});
test('paused communications are not claimed and paid notice can resume without duplicates',async()=>{
 paid=true;tables.workflow_events?.push({job_id:'j',event_type:'install_deposit_received',created_at:'2026-11-01T00:00:00Z',details:{invoice_id:'i'}});paused=true;await notifyInstallerDepositPaid('j',new Date('2026-11-01T00:00:00Z'));expect(emails.length+texts.length+offices.length).toBe(0);
 paused=false;await notifyInstallerDepositPaid('j',new Date('2026-11-01T00:00:00Z'));expect(offices).toHaveLength(1);
});
test('quiet-hour request retries during daytime with one email and one text',async()=>{
 await requestInstallDeposit('j',new Date('2026-11-01T10:00:00Z'));expect(emails.length+texts.length).toBe(0);
 await requestInstallDeposit('j',new Date('2026-11-01T20:00:00Z'));expect(emails).toHaveLength(1);expect(texts).toHaveLength(1);
});
test('a stale recorded request is not released by the tick as an old request',async()=>{
 await requestInstallDeposit('j',new Date('2026-11-01T10:00:00Z'));
 await sweepDepositRequests(new Date('2026-11-03T00:00:00Z'));expect(emails.length+texts.length).toBe(0);
});
test('late invoice preserves clearance intent and resumes once invoice exists',async()=>{
 invoiceMissing=true;await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));expect(tables.workflow_events?.some(e=>e.event_type==='install_deposit_request_pending')).toBe(true);
 invoiceMissing=false;await sweepDepositRequests(new Date('2026-11-02T00:00:00Z'));await sweepDepositRequests(new Date('2026-11-02T00:00:00Z'));expect(emails).toHaveLength(1);
});
test('failed payment reads preserve pending request and repeated failures raise office task',async()=>{
 invoiceReadFails=true;for(let i=0;i<3;i++)await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));
 expect(tables.workflow_events?.some(e=>e.event_type==='install_deposit_request_pending')).toBe(true);expect(tables.workflow_events?.some(e=>e.event_type==='install_deposit_request_failed')).toBe(true);
 invoiceReadFails=false;await sweepDepositRequests(new Date('2026-11-02T00:00:00Z'));expect(emails).toHaveLength(1);
});
test('installer deposit rejection retries after 24 hours and successful send never repeats',async()=>{
 paid=true;tables.workflow_events?.push({job_id:'j',event_type:'install_deposit_received',created_at:'2026-11-01T00:00:00Z',details:{invoice_id:'i'}});
 officeOutcome='failed';await notifyInstallerDepositPaid('j',new Date('2026-11-01T00:00:00Z'));officeOutcome='sent';await notifyInstallerDepositPaid('j',new Date('2026-11-03T00:00:00Z'));await notifyInstallerDepositPaid('j',new Date('2026-11-03T00:00:00Z'));expect(offices).toHaveLength(2);expect(texts.every(s=>s.to!=='office@example.invalid')).toBe(true);
});// Part 4 fix wave C1 (Jo answer 21): a partner-billed in-house job whose PIESA found upgrades auto-advances to
// rectification_scheduling — the deposit request, its day 3/7 reminders and the sweep must all still cover it.
const UPGRADES_PIESA={id:'pr',job_id:'j',kind:'initial',outcome:'fail',is_current:true,completed_date:'2026-10-30',signed_off_by:'e',created_at:'2026-10-30T00:00:00Z'};
// J5 (4 Nov 2026, J4 G3 "never all clear on an upgrades-needed result" + the Part 9 Task 10 ruling): the deposit facts now
// exist while the upgrades are outstanding (the 30 days run from the PIESA date), so with the Upgrades-needed email still
// unapproved the request is HELD before anything is recorded (the pending intent retries each tick; no reminder starts from
// a request that never went). Once that email is approved it carries the deposit button and the request is "covered".
const { defaultClearToInstallDeps } = await import('../src/lib/deposit-request.server');
const upgradesDeps=(on:boolean)=>({...defaultClearToInstallDeps(),approved:false,upgradesApproved:on,route:async()=>on?['upgrades_needed' as const]:['standalone_copy' as const]});
test('upgrades still to come at rectification_scheduling: the request is HELD (not recorded, no sends) while the Upgrades-needed email is unapproved; the intent stays for the tick',async()=>{
 tables.jobs![0]!.stage='rectification_scheduling';tables.piesa_records=[UPGRADES_PIESA];
 tables.rectification_items=[{id:'r',job_id:'j',status:'required',description:'Switchboard',needs_office_pricing:false}];
 cleared=false;basis='none';
 expect(await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'),upgradesDeps(false))).toBe('held: electrical upgrades needed wording not approved');
 expect(emails).toHaveLength(0);expect(texts).toHaveLength(0);
 expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(0);
 expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_request_pending')).toHaveLength(1);
 // the sweep finds the job at a rectification_* stage: still held, no reminders start
 tables.jobs![0]!.stage='rectification_booked';
 await sweepDepositRequests(new Date('2026-11-04T00:00:00Z'),upgradesDeps(false));expect(emails).toHaveLength(0);expect(texts).toHaveLength(0);
 // the upgrades are done and the Section C / CoES recorded: the one request goes now (cleared)
 tables.piesa_records.push({id:'pr2',job_id:'j',kind:'post_rectification',outcome:'pass',is_current:true,completed_date:'2026-11-09',signed_off_by:'e',section_c_signed_at:'2026-11-09T00:00:00Z',rectification_completed_at:'2026-11-09T00:00:00Z',created_at:'2026-11-09T00:00:00Z'});
 UPGRADES_PIESA.is_current=false;tables.rectification_items[0]!.status='completed';tables.jobs![0]!.stage='installation_scheduling';cleared=true;basis='section_c';
 await sweepDepositRequests(new Date('2026-11-09T01:00:00Z'),upgradesDeps(false));
 expect(emails).toHaveLength(1);expect(texts).toHaveLength(1);expect(emails[0].purpose).toBe('install_deposit_request');
 expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(1);
 UPGRADES_PIESA.is_current=true;
});
test('upgrades still to come with the Upgrades-needed email approved: that email carries the deposit, the request is recorded as covered; day 3 and day 7 reminders follow; nothing more after the later CoES',async()=>{
 tables.jobs![0]!.stage='rectification_scheduling';tables.piesa_records=[UPGRADES_PIESA];
 tables.rectification_items=[{id:'r',job_id:'j',status:'required',description:'Switchboard',needs_office_pricing:false}];
 cleared=false;basis='none';
 expect(await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'),upgradesDeps(true))).toBe('covered by the electrical upgrades needed email');
 expect(emails).toHaveLength(0);expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(1);
 tables.workflow_events=tables.workflow_events!.filter(e=>e.event_type!=='install_deposit_request_pending'&&e.event_type!=='install_deposit_request_resolved');
 tables.jobs![0]!.stage='rectification_booked';
 await sweepDepositRequests(new Date('2026-11-04T00:00:00Z'),upgradesDeps(true));expect(emails).toHaveLength(1);expect(emails[0].purpose).toBe('install_deposit_day3');
 await sweepDepositRequests(new Date('2026-11-08T00:00:00Z'),upgradesDeps(true));expect(emails).toHaveLength(2);expect(emails[1].purpose).toBe('install_deposit_day7');expect(texts).toHaveLength(2);
 tables.piesa_records.push({id:'pr2',job_id:'j',kind:'post_rectification',outcome:'pass',is_current:true,completed_date:'2026-11-09',signed_off_by:'e',section_c_signed_at:'2026-11-09T00:00:00Z',rectification_completed_at:'2026-11-09T00:00:00Z',created_at:'2026-11-09T00:00:00Z'});
 UPGRADES_PIESA.is_current=false;tables.rectification_items[0]!.status='completed';tables.jobs![0]!.stage='installation_scheduling';cleared=true;basis='section_c';
 await requestInstallDeposit('j',new Date('2026-11-09T01:00:00Z'),upgradesDeps(true));await sweepDepositRequests(new Date('2026-11-09T01:00:00Z'),upgradesDeps(true));
 expect(emails).toHaveLength(2);expect(texts).toHaveLength(2);expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(1);
 UPGRADES_PIESA.is_current=true;
});
test('the sweep picks up an unrequested upgrades-pending job at rectification_scheduling only through a recorded pending intent (held until the Upgrades-needed email is approved)',async()=>{
 tables.jobs![0]!.stage='rectification_scheduling';tables.piesa_records=[UPGRADES_PIESA];cleared=false;
 await sweepDepositRequests(new Date('2026-11-01T00:00:00Z'),upgradesDeps(true));expect(emails).toHaveLength(0);expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(0); // no historical catch-up without an intent
 tables.workflow_events!.push({id:'pend',job_id:'j',event_type:'install_deposit_request_pending',details:{attempts:0}});
 await sweepDepositRequests(new Date('2026-11-01T00:00:00Z'),upgradesDeps(false));expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(0); // held
 await sweepDepositRequests(new Date('2026-11-01T00:00:00Z'),upgradesDeps(true));expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(1); // covered by that email
});
// Fix wave I1: the computed purpose reaches the delivery assert — Deposit received is a compliance send, the ask is not.
test('unsubscribed owner: Deposit received still goes (install_deposit_paid is a compliance purpose); the request is held',async()=>{
 tables.owner_contact_consents!.push({id:'c2',job_id:'j',consent_status:'not_granted',source:'unsubscribe',created_at:'2026-10-20T00:00:00Z'});
 await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));expect(emails).toHaveLength(0);expect(texts).toHaveLength(0);
 paid=true;tables.workflow_events?.push({job_id:'j',event_type:'install_deposit_received',created_at:'2026-11-01T00:00:00Z',details:{invoice_id:'i'}});
 const r=await notifyInstallerDepositPaid('j',new Date('2026-11-01T00:00:00Z'));
 expect(r.startsWith('sent')).toBe(true);expect(emails).toHaveLength(1);expect(emails[0].purpose).toBe('install_deposit_paid');expect(offices).toHaveLength(1);
});
