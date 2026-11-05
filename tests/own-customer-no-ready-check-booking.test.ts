import { expect, test } from 'bun:test';
import { nextStepBox, type NextStepFacts } from '../src/lib/next-step-box.core';
const base: NextStepFacts = {
 channel:'installer_sourced',stage:'ready_check_ready_to_schedule',ownerFirst:'Tom',ownerName:'Tom',ownerPhone:null,
 now:new Date('2026-11-05T08:00:00Z'),givenAt:'2026-09-01T00:00:00Z',readyCheck:{start:null,done:false,missing:[]},
 priceEntered:false,quote:'none',acceptedAt:null,whoBooks:'office',electricianName:null,
 piesa:{start:null,outcome:null,upgradesDone:false,certificateIn:false},access:null,depositPaidAt:null,
 install:{start:null,lead:null,swmsSigned:0,swmsTotal:0},installDone:false,pay:null,mittiFormUrl:null,
};
test('own customer has no Ready Check booking or deadline, including a historical booked visit',()=>{
 for(const start of [null,'2026-10-01T22:00:00Z']) {
  const b=nextStepBox({...base,readyCheck:{...base.readyCheck,start,person:null}});
  expect(b.kind).toBe('own_ready_check');expect(b.bookBy).toBeNull();expect(b.overdue).toBe(false);expect(b.pickPerson).toBeNull();
 }
});
test('completed own customer form opens the inline price state',()=>{
 expect(nextStepBox({...base,readyCheck:{...base.readyCheck,done:true}}).kind).toBe('enter_price');
});
test('saved price waits for office without a visit clock',()=>{
 const b=nextStepBox({...base,priceEntered:true});expect(b.kind).toBe('waiting_quote');expect(b.bookBy).toBeNull();
});
test('Home Insulation Victoria lead still has the Ready Check booking deadline',()=>{
 expect(nextStepBox({...base,channel:'hivic_sourced'}).kind).toBe('book_ready_check');
 expect(nextStepBox({...base,channel:'hivic_sourced'}).bookBy).not.toBeNull();
});