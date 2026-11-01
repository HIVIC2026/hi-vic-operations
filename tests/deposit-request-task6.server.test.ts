import { beforeEach, expect, mock, test } from 'bun:test';
import { memoryPostgrest, type Tables } from './helpers/memory-postgrest';
const tables:Tables={};const admin=memoryPostgrest(tables);
let cleared=true,basis='initial_piesa',paid=false,failed=false,held=true,paused=false,invoiceMissing=false,invoiceReadFails=false,officeOutcome='sent';
const emails:any[]=[],texts:any[]=[],offices:any[]=[];
const emailKeys=new Set<string>(),smsKeys=new Set<string>();
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:admin}));
mock.module('../src/lib/in-house-suppression.server',()=>({readInHouseDispatchState:async()=>({failed,held:new Set(held?['j']:[])})}));
mock.module('../src/lib/install-days.server',()=>({installDayContext:async()=>({clearance:{cleared,basis},deadline:'2026-11-30',booked:false})}));
mock.module('../src/lib/payments.server',()=>({jobPaymentView:async()=>{if(invoiceReadFails)throw Error('read failed');return invoiceMissing?null:({invoiceId:'i',invoices:{install:{id:'i',xero_invoice_id:'x'}},plan:{installDepositCents:36510},steps:[{key:'install_deposit',state:paid?'paid':'due',outstandingCents:paid?0:36510}],bank:{configured:true,accountName:'Practice',bsb:'123456',accountNumber:'12345678'},reference:'INV-1',stripe:{available:true}});}}));
mock.module('../src/lib/veec-copy-email.server',()=>({ownerMyJobLink:async()=> 'https://example.invalid/my-job/token'}));
mock.module('../src/lib/comms.server',()=>({assertCustomerDeliveryAllowed:async()=>{if(paused)throw Error('held');}}));
mock.module('../src/lib/trade-pause.server',()=>({tradeMessagesPausedNow:async()=>paused?'paused':null}));
mock.module('../src/lib/qa-inbox.server',()=>({qaDeliveryHeld:async()=>false}));
mock.module('../src/lib/owner-email-send.server',()=>({sendGuardedOwnerEmail:async(p:any)=>{if(emailKeys.has(p.key))return 'already attempted';emailKeys.add(p.key);emails.push({...p,mail:p.build(null)});return 'sent';}}));
mock.module('../src/lib/sms.server',()=>({sendRealSms:async(p:any)=>{if(smsKeys.has(p.idempotencyKey))return{status:'already'};smsKeys.add(p.idempotencyKey);texts.push(p);return {status:'sent'};}}));
mock.module('../src/lib/office-email.server',()=>({sendOfficeEmail:async(p:any)=>{offices.push(p);return{status:officeOutcome,detail:officeOutcome==='failed'?"The email service didn't accept it":'mock'};}}));
const {requestInstallDeposit,sweepDepositRequests,notifyInstallerDepositPaid}=await import('../src/lib/deposit-request.server');
beforeEach(()=>{
 for(const k of Object.keys(tables))delete tables[k];
 tables.jobs=[{id:'j',job_number:'HV-1234',source:'website',stage:'installation_scheduling',owner_id:'o',property_id:'p',deleted_at:null,qa_archived_at:null}];
 tables.owners=[{id:'o',full_name:'Jo Owner',email:'owner@example.invalid',phone:'0412345678'}];
 tables.properties=[{id:'p',address_line:'1 Practice St',suburb:'Melbourne',postcode:'3000'}];
 tables.businesses=[{id:'b',name:'Practice Insulation',email:'office@example.invalid',in_house:true}];
 tables.job_assignments=[{id:'a',job_id:'j',business_id:'b',user_id:'u',role:'installer',active:true}];
 tables.workflow_events=[];tables.customer_email_sends=[];
 emails.length=texts.length=offices.length=0;emailKeys.clear();smsKeys.clear();cleared=held=true;basis='initial_piesa';paid=failed=paused=false;
 invoiceMissing=invoiceReadFails=false;officeOutcome='sent';
});
test('pass requests one owner email and link-free text, replay sends neither again',async()=>{
 await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));
 expect(emails).toHaveLength(1);expect(texts).toHaveLength(1);expect(emails[0].key).toBe('install-deposit:v1:i');expect(offices).toHaveLength(0);
 expect(texts[0].body).not.toMatch(/https?:|www\./);expect(tables.workflow_events?.filter(e=>e.event_type==='install_deposit_requested')).toHaveLength(1);
});
test('rectification needed requests nothing until completed',async()=>{
 cleared=false;await requestInstallDeposit('j');expect(emails.length+texts.length).toBe(0);
 cleared=true;basis='section_c';await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));expect(emails).toHaveLength(1);
});
test('recorded request gets day 3/day 7 once, none after paid',async()=>{
 await requestInstallDeposit('j',new Date('2026-11-01T00:00:00Z'));
 await sweepDepositRequests(new Date('2026-11-04T00:00:00Z'));await sweepDepositRequests(new Date('2026-11-04T00:00:00Z'));
 await sweepDepositRequests(new Date('2026-11-08T00:00:00Z'));expect(emails).toHaveLength(3);expect(texts).toHaveLength(3);
 paid=true;tables.workflow_events?.push({job_id:'j',event_type:'install_deposit_received',created_at:'2026-11-09T00:00:00Z',details:{invoice_id:'i'}});await sweepDepositRequests(new Date('2026-11-09T00:00:00Z'));expect(emails).toHaveLength(4);expect(texts).toHaveLength(4);expect(offices).toHaveLength(1);
});
for(const source of ['stripe','xero'])test(`${source} confirmed deposit tells owner and installer office once, never texts office`,async()=>{
 paid=true;tables.workflow_events?.push({job_id:'j',event_type:'install_deposit_received',created_at:'2026-11-01T00:00:00Z',details:{invoice_id:'i',source}});
 await notifyInstallerDepositPaid('j',new Date('2026-11-01T00:00:00Z'));await notifyInstallerDepositPaid('j',new Date('2026-11-01T00:00:00Z'));
 expect(emails).toHaveLength(1);expect(offices).toHaveLength(1);expect(offices[0].to).toBe('office@example.invalid');expect(texts).toHaveLength(1);expect(texts[0].to).toBe('0412345678');
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
});