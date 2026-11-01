import { expect, test } from 'bun:test';
import { createInHouseSim } from './helpers/sim-in-house';

test('SIM fake Melbourne clock, fail-closed provider boundary and distinct actors', async () => {
  const h = createInHouseSim();
  expect(h.clock.day()).toBe('2026-11-02');
  expect(h.clock.hour()).toBe(9);
  expect(h.actorCanRead('other-office')).toBe(false);
  expect(h.actorCanRead('installer-office')).toBe(true);
  await expect(h.external('https://api.stripe.com')).rejects.toThrow('Network prohibited');
});

test('SIM all-clear booking/forms/deposit/digest sequence uses one continuing job', async () => {
  const h=createInHouseSim();
  await h.bookReadyCheck();
  h.assertStep('Ready Check booked','ready_check_scheduled',['RC','A3','A4'],[
    ['owner','email','in_house_booked'],['owner','sms','in_house_booked_owner'],
  ]);
  await h.bookReadyCheck(true);
  h.assertNoNewMessages();
  h.completeReadyCheck(); h.acceptQuote(); h.paySafetyCheck();
  await h.bookSafetyCheck();
  h.assertStep('PIESA booked','piesa_scheduled',['RC','A3','A4'],[
    ['owner','email','in_house_booked'],['owner','sms','in_house_booked_owner'],
  ]);
  await h.completePiesa(false);
  h.assertStep('PIESA pass','installation_scheduling',['RC','A3','A4'],[
    ['owner','email','install_deposit_request'],['owner','sms','install_deposit_request'],
  ]);
  await h.payDeposit('stripe');
  h.assertStep('Deposit paid','installation_scheduling',['RC','A3','A4'],[
    ['owner','email','install_deposit_paid'],['owner','sms','install_deposit_paid'],['installer-office','email','install_deposit_paid_office'],
  ]);
  await h.confirmPiesa(); await h.bookInstall();
  h.assertStep('Install booked','installation_booked',['RC','A3','A4','A5'],[
    ['owner','email','in_house_booked'],['owner','sms','in_house_booked_owner'],
  ]);
  h.clock.set('2026-11-15T02:59:00Z'); await h.digest();h.assertNoNewMessages();
  h.clock.set('2026-11-15T03:00:00Z'); await h.digest();
  h.assertStep('2pm day before','installation_booked',['RC','A3','A4','A5'],[
    ['installer-office','email','in-house-install-office:v1:biz:2026-11-16'],
  ]);
  await h.digest();h.assertNoNewMessages();h.assertOfficesEmailOnly();
});

test('SIM rectification holds deposit until work complete; Xero paid notice is email-only to office',async()=>{
  const h=createInHouseSim();await h.bookReadyCheck();h.completeReadyCheck();h.acceptQuote();h.paySafetyCheck();await h.bookSafetyCheck();
  h.checkpoint();await h.completePiesa(true);h.assertStep('Rectification needed','rectification_scheduling',['RC','A3','A4'],[]);
  await h.tryDeposit();h.assertNoNewMessages();await h.completeRectification();
  h.assertStep('Rectification done','installation_scheduling',['RC','A3','A4'],[['owner','email','install_deposit_request'],['owner','sms','install_deposit_request']]);
  await h.payDeposit('xero');h.assertStep('Xero deposit paid','installation_scheduling',['RC','A3','A4'],[['owner','email','install_deposit_paid'],['owner','sms','install_deposit_paid'],['installer-office','email','install_deposit_paid_office']]);
  await h.confirmPiesa();await h.bookInstall();h.assertOfficesEmailOnly();
});

test('SIM deposit unpaid day 3/day 7; paid gate never allows installation',async()=>{
 const h=createInHouseSim();await h.atClearance();await h.tryDeposit();h.checkpoint();
 h.clock.set('2026-11-05T22:00:00Z');await h.sweepDeposits();
 h.assertStep('Day 3','installation_scheduling',['RC','A3','A4'],[['owner','email','install_deposit_day3'],['owner','sms','install_deposit_reminder']]);
 h.clock.set('2026-11-09T22:00:00Z');await h.sweepDeposits();
 h.assertStep('Day 7','installation_scheduling',['RC','A3','A4'],[['owner','email','install_deposit_day7'],['owner','sms','install_deposit_reminder']]);
 await h.sweepDeposits();h.assertNoNewMessages();expect(await h.installOffered()).toBe(false);
 await expect(h.bookInstall()).rejects.toThrow('10%');h.assertOfficesEmailOnly();
});

test('SIM owner cancellation closes unused forms and emails only HIV office, replay safe',async()=>{
 const h=createInHouseSim();await h.bookReadyCheck();h.checkpoint();await h.cancel('Owner changed plans');
 h.assertStep('Owner cancelled','cancelled',['RC','A3','A4'],[['hiv-office','email','in_house_owner_cancelled']]);
 expect(h.closedForms().sort()).toEqual(['A3','A4','RC']);expect(h.actorCanRead('electrician')).toBe(false);
 await expect(h.cancel('Owner changed plans')).rejects.toThrow('already cancelled');h.assertNoNewMessages();h.assertOfficesEmailOnly();
});

test('SIM Lead Installer day-before and morning swaps move A5/SWMS; matching ESC acknowledgement unlocks',async()=>{
 const h=createInHouseSim();await h.atInstallBooked();h.clock.set('2026-11-14T22:00:00Z');await h.swap('replacement');
 expect(h.formOwner('A5')).toBe('replacement@example.invalid');expect(h.canSignSwms('lead')).toBe(false);expect(h.canSignSwms('replacement')).toBe(true);expect(await h.prestartBlocker()).toBeNull();
 h.clock.set('2026-11-15T21:00:00Z'); // 8am Melbourne on the installation day
 await h.swap('lead');expect(h.formOwner('A5')).toBe('lead@example.invalid');expect(h.canSignSwms('replacement')).toBe(false);
 expect(await h.prestartBlocker()).toBe('Waiting for Home Insulation Victoria to update the ESC notice for your new Lead Installer.');
 h.ackEsc();expect(await h.prestartBlocker()).toBeNull();h.assertOfficesEmailOnly();
});

test('SIM thirty-day 20/10 warnings, office flag, expiry repeat choice',async()=>{
 const h=createInHouseSim();await h.atClearance();h.checkpoint();
 h.clock.set('2026-11-12T22:00:00Z');await h.windowWarnings();
 h.assertStep('20 days left','installation_scheduling',['RC','A3','A4'],[['owner','email','install_window_reminder_20'],['owner','sms','install_window_reminder'],['installer-office','email','install_window_reminder_20']]);
 h.clock.set('2026-11-22T22:00:00Z');await h.windowWarnings();
 h.assertStep('10 days left','installation_scheduling',['RC','A3','A4'],[['owner','email','install_window_reminder_10'],['owner','sms','install_window_reminder'],['installer-office','email','install_window_reminder_10']]);
 expect(h.tenDayFlag()).toBe(true);h.clock.set('2026-12-03T22:00:00Z');expect(h.repeatDecision().stage).toBe('choose');await expect(h.bookInstall()).rejects.toThrow();h.assertOfficesEmailOnly();
});

test('SIM two-business-day flag keeps job assigned and handback preserves reason',async()=>{
 const h=createInHouseSim();h.clock.set('2026-11-05T22:00:00Z');expect(h.bookingOverdue()).toBe(true);expect(h.actorCanRead('installer-office')).toBe(true);
 await expect(h.handBack('Cannot cover this address','other-office')).rejects.toThrow('Not your in-house job');
 expect(h.officeCandidates().map(r=>r.kind)).toContain('in_house_ready_check_not_booked');
 await h.handBack('Cannot cover this address');expect(h.actorCanRead('installer-office')).toBe(false);expect(h.job.stage).toBe('ready_check_ready_to_schedule');expect(h.handbackReason()).toBe('Cannot cover this address');expect(h.officeCandidates().map(r=>r.kind)).toContain('in_house_handed_back');h.assertOfficesEmailOnly();
});

test('SIM retained CoES sends exact owner certificate email/attachment once and records current document set',async()=>{
 const h=createInHouseSim();await h.atInstallBooked();h.checkpoint();await h.uploadCoes();
 h.assertStep('CoES retained','installation_booked',['RC','A3','A4','A5'],[['owner','email','coes_owner_copy']]);
 expect(h.messages.at(-1)?.attachments).toEqual([{filename:'Certificate-of-Electrical-Safety-1.pdf',contentType:'application/pdf',content:Buffer.from('SIM certificate').toString('base64')}]);
 expect(h.tables.job_compliance_records.map(r=>r.record_key)).toEqual(['pre_install_consumer_docs']);
 await h.uploadCoes();h.assertNoNewMessages();h.assertOfficesEmailOnly();
});

test('SIM repeat PIESA uses office choice, owner acceptance and only its own fully-paid invoice',async()=>{
 const h=createInHouseSim();await h.atClearance();h.clock.set('2026-12-03T22:00:00Z');
 expect((await h.repeatContext()).stage).toBe('choose');
 expect((await h.chooseRepeat()).stage).toBe('owner_accept');
 expect((await h.acceptRepeat()).stage).toBe('owner_pay');
 expect(await h.payRepeat('invoice',34900)).toBe(false);
 expect(await h.payRepeat('repeat-invoice',34899)).toBe(false);
 expect(await h.payRepeat('repeat-invoice',34900)).toBe(true);
 expect((await h.repeatContext()).stage).toBe('offer');
 expect(await h.payRepeat('repeat-invoice',34900)).toBe(false);
});

test('SIM actual booking Team refuses another business and unsigned PIESA refuses installation despite deposit paid',async()=>{
 const h=createInHouseSim();await h.atClearance();await h.payDeposit('stripe');
 await expect(h.readTeam('other-office')).rejects.toThrow('Not your job');
 expect((await h.readTeam('installer-office')).depositPaid).toBe(true);
 await expect(h.bookInstall()).rejects.toThrow('confirm');
 await h.confirmPiesa();await h.bookInstall();expect(h.job.stage).toBe('installation_booked');
});

test('SIM Melbourne clock crosses both DST boundaries without a fixed offset',()=>{
 const h=createInHouseSim();h.clock.set('2026-04-04T14:00:00Z');expect(h.clock.day()).toBe('2026-04-05');expect(h.clock.hour()).toBe(1);
 h.clock.set('2026-04-05T13:00:00Z');expect(h.clock.day()).toBe('2026-04-05');expect(h.clock.hour()).toBe(23);
 h.clock.set('2026-10-03T15:00:00Z');expect(h.clock.day()).toBe('2026-10-04');expect(h.clock.hour()).toBe(1);
 h.clock.set('2026-10-04T12:00:00Z');expect(h.clock.day()).toBe('2026-10-04');expect(h.clock.hour()).toBe(23);
});

// Explicit missing whole-job proofs; these must never be counted as scenario PASS.
test.todo('SIM whole-job: real enquiry → Save my spot → quick taps → five-job in-house handoff');
test.todo('SIM whole-job: actual Ready Check sync → quote generation → code verification → four signatures → $349 ledger');
test.todo('SIM whole-job: immediate booked PIESA notification to the selected electrician');
test.todo('SIM whole-job: actual A3/A4 completion and issued rectification quote/payment progression');
test.todo('SIM whole-job: completed A5 evidence → VEEC owner signature → AP verification → close');
test.todo('SIM whole-job: full per-role UI/read and database RLS matrix at every step');

test('SIM combined PIESA copy/declaration email is delivered before install booking, once, with PDF',async()=>{
 const h=createInHouseSim();await h.atClearance();h.checkpoint();await h.deliverSafetyCopy();
 h.assertStep('PIESA copy before install','installation_scheduling',['RC','A3','A4'],[['owner','email','piesa_copy']]);
 const owner=h.messages.find(m=>m.template==='piesa_copy'&&m.who==='owner');expect(owner?.attachments).toHaveLength(1);expect(owner?.body).toContain('Confirm my safety check');
 await h.deliverSafetyCopy();h.assertNoNewMessages();h.assertOfficesEmailOnly();
});
