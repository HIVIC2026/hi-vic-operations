import {expect,test} from 'bun:test';
import {bookingWorkerBlocker,emptyBookingTeamBlocker,leadNoticePending,type BookingWorker} from '../src/lib/in-house-booking.core';
const worker:BookingWorker={id:'lead',name:'Pat Smith',phone:null,tradeRole:'installer',workerRole:'lead',cleared:true,reason:null,escRegistered:false};
test('eligible unregistered Lead Installer waits for HIV registration',()=>{
 expect(bookingWorkerBlocker('installation',worker)).toBe('Waiting for Home Insulation Victoria to register Pat Smith with ESC. Every Lead Installer must be registered with ESC before we can lodge the install notice.');
 expect(emptyBookingTeamBlocker('installation',[worker])).toBe(bookingWorkerBlocker('installation',worker));
});
test('a post-notice Lead swap does not hold prestart until the exact install start',()=>{
 const change={id:'c',at:'2026-11-01T21:00:00Z',start:'2026-11-03T21:00:00Z'};
 expect(leadNoticePending(change,null,new Date('2026-11-03T20:59:59Z'))).toBe(false);
 expect(leadNoticePending(change,null,new Date(change.start))).toBe(true);
 expect(leadNoticePending(change,'c',new Date(change.start))).toBe(false);
});