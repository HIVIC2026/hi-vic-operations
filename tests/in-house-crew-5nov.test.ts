import {expect,test} from 'bun:test';
import {bookingWorkerBlocker,type BookingWorker} from '../src/lib/in-house-booking.core';
const crew:BookingWorker={id:'crew',name:'Crew member',phone:null,tradeRole:'installer',workerRole:'crew',cleared:true,reason:"Crew can't be the install-day Lead"};
test('Crew is eligible for Ready Check without install Lead requirements',()=>{
 expect(bookingWorkerBlocker('ready_check',crew)).toBeNull();
 expect(bookingWorkerBlocker('ready_check',{...crew,cleared:false})).toBeNull();
});
test('Crew cannot occupy the install Lead slot',()=>{
 expect(bookingWorkerBlocker('installation',crew)).not.toBeNull();
});
test('PIESA still needs a verified electrician',()=>{
 expect(bookingWorkerBlocker('assessment',crew)).not.toBeNull();
});