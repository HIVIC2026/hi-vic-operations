import { expect, test } from 'bun:test';
import { nextStepBox, NEXT_STEP_WORDS, type NextStepFacts } from '../src/lib/next-step-box.core';
const base: NextStepFacts = {
 channel:'installer_sourced',stage:'ready_check_ready_to_schedule',ownerFirst:'Tom',ownerName:'Tom',ownerPhone:null,
 now:new Date('2026-11-05T08:00:00Z'),givenAt:'2026-09-01T00:00:00Z',readyCheck:{start:null,done:false,missing:[]},
 priceEntered:false,quote:'none',acceptedAt:null,whoBooks:'office',electricianName:null,
 piesa:{start:null,outcome:null,upgradesDone:false,certificateIn:false},access:null,depositPaidAt:null,
 install:{start:null,lead:null,swmsSigned:0,swmsTotal:0},installDone:false,pay:null,mittiFormUrl:null,
};
test('own customer no photos shows Enter your price, with no Ready Check booking or deadline, including a historical booked visit',()=>{
 for(const start of [null,'2026-10-01T22:00:00Z']) {
  const b=nextStepBox({...base,readyCheck:{...base.readyCheck,start,person:null}});
  expect(b.kind).toBe('enter_price');expect(b.title).toBe(NEXT_STEP_WORDS.enterPriceTitle);expect(b.yours).toBe(true);expect(b.bookBy).toBeNull();expect(b.overdue).toBe(false);expect(b.pickPerson).toBeNull();
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
test('no box ever says Do it in Mitti',()=>{
 const seen:string[]=[];
 for(const channel of ['installer_sourced','hivic_sourced'] as const) for(const done of [false,true]) for(const priceEntered of [false,true,null]) for(const quote of ['none','sent','accepted','declined'] as const) for(const start of [null,'2026-11-10T00:00:00Z']) for(const quoteMethod of [undefined,'photos'] as const)
  seen.push(JSON.stringify(nextStepBox({...base,channel,priceEntered:channel==='installer_sourced'?priceEntered:null,quote,quoteMethod,readyCheck:{start,done,missing:[],person:null}})));
 expect(seen.length).toBeGreaterThan(100);
 for(const j of seen){expect(j).not.toContain('Do it in Mitti');expect(j).not.toContain('own_ready_check');}
});
