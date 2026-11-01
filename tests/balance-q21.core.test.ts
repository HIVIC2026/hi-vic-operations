import {test,expect} from 'bun:test';
import {balanceDueAt,balanceReminderDue,balanceOverdue} from '../src/lib/balance-q21.core';
import {paymentMethodsFor,paymentPlan,paymentSteps} from '../src/lib/payments.core';
import {stripeBlocker,parseStripeEvent,checkoutSessionParams} from '../src/lib/stripe.core';
test('Q21 due seven calendar days after recorded completion at Melbourne end of day across DST',()=>{
 expect(balanceDueAt('2026-10-01T23:00:00Z')).toBe('2026-10-09T12:59:59.999Z');
 expect(balanceDueAt('2026-04-02T23:00:00Z')).toBe('2026-04-10T13:59:59.999Z');
 expect(balanceDueAt(null)).toBeNull();
});
test('Q21 day five and due-day reminders only, paid suppresses both',()=>{
 const completed='2026-11-01T23:00:00Z';
 expect(balanceReminderDue(completed,false,new Date('2026-11-06T23:00:00Z'))).toBe('day5');
 expect(balanceReminderDue(completed,false,new Date('2026-11-08T23:00:00Z'))).toBe('due');
 expect(balanceReminderDue(completed,false,new Date('2026-11-07T23:00:00Z'))).toBeNull();
 expect(balanceReminderDue(completed,true,new Date('2026-11-08T23:00:00Z'))).toBeNull();
});
test('Q21 unpaid overdue next Melbourne day, not on due day, clears on payment',()=>{
 expect(balanceOverdue('2026-11-01T23:00:00Z',false,new Date('2026-11-09T12:59:59.999Z'))).toBe(false);
 expect(balanceOverdue('2026-11-01T23:00:00Z',false,new Date('2026-11-09T13:00:00Z'))).toBe(true);
 expect(balanceOverdue('2026-11-01T23:00:00Z',true,new Date('2026-11-10T00:00:00Z'))).toBe(false);
});
test('Q21 balance card and bank; outstanding only on existing install invoice',()=>{
 expect(paymentMethodsFor('balance')).toEqual(['card','bank']);
 const p=paymentPlan({quoteTotalCents:134900,safetyCheckCents:34900});
 const s=paymentSteps(p,{install:44900,fixes:0,repeat:0},{balance:{requestedAt:'2026-11-01',dueAt:'2026-11-09T12:59:59.999Z'}},'2026-11-06T00:00:00Z');
 expect(s.find(x=>x.key==='balance')?.outstandingCents).toBe(90000);
 const f={jobId:'j',invoiceId:'existing',step:'balance' as const,amountCents:90000,jobNumber:'HV-TEST',description:'Balance',successUrl:'https://example.invalid',cancelUrl:'https://example.invalid',customerEmail:null,jobSource:'qa_test'};
 expect(checkoutSessionParams(f).idempotencyKey).toBe(checkoutSessionParams(f).idempotencyKey);
 expect(checkoutSessionParams(f).form['metadata[invoice_id]']).toBe('existing');
});
test('Q21 TEST balance accepts test key only and webhook parses balance receipt',()=>{
 expect(stripeBlocker({enabled:false,secretKey:'sk_test_dummy',jobSource:'qa_test',step:'balance',amountCents:90000})).toBeNull();
 expect(stripeBlocker({enabled:true,secretKey:'sk_live_dummy',jobSource:'qa_test',step:'balance',amountCents:90000})).toBe('TEST jobs may only use Stripe test mode.');
 expect(parseStripeEvent(JSON.stringify({id:'evt',type:'checkout.session.completed',livemode:false,created:1,data:{object:{payment_status:'paid',amount_total:90000,metadata:{job_id:'j',invoice_id:'existing',step:'balance'},payment_intent:'pi',id:'cs'}}}))?.fact?.step).toBe('balance');
});