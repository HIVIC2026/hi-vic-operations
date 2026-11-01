import { expect, test } from 'bun:test';
import { emptyBookingTeamBlocker } from '../src/lib/in-house-booking.core';
import { IN_HOUSE_ELECTRICIAN_BOOKING_BLOCKER } from '../src/lib/worker-compliance.core';
import { ownerInstallWindowText } from '../src/lib/thirty-day-rule.core';
import { practiceHandback } from './helpers/sim-handback-practice';
test('empty electrician Team explains verification required',()=>{
 expect(emptyBookingTeamBlocker('assessment',[])).toBe(IN_HOUSE_ELECTRICIAN_BOOKING_BLOCKER);
});
test('empty eligible Lead Installer Team explains ESC registration required',()=>{
 expect(emptyBookingTeamBlocker('installation',[])).toBe('Add a Lead Installer to your Team to book the install. ESC needs us to name a registered Lead Installer on the install notice at least 24 hours before.');
});
for(const inHouse of [true,false]) test(`30-day owner text has no pay/sign link (${inHouse})`,()=>{
 const text=ownerInstallWindowText({inHouse,step:'reminder_10',deadline:'2026-11-30',daysLeft:10,link:'https://example.invalid/my-job/token?screen=pay'});
 expect(text).not.toMatch(/https?:|screen=pay|screen=sign/);
 expect(text.endsWith('Details in your email.')).toBe(true);
});
test('pending handback accepts own-office qa_test and cancels electrical/Ready Check bookings only',async()=>{
 const result=await practiceHandback('Cannot attend',true,'qa_test');
 expect(result.assignments.every(a=>!a.active)).toBe(true);
 expect(result.bookings.filter(b=>['ready_check','assessment'].includes(b.kind)).every(b=>b.status==='cancelled')).toBe(true);
 expect(result.bookings.find(b=>b.kind==='installation')?.status).toBe('confirmed');
});