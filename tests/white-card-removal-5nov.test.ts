import {expect,test} from 'bun:test';
import {approvalFlags,missingItems,requiredOnFileBlockers,whiteCardOf} from '../src/lib/worker-compliance.core';
import {teamWhiteCardLine} from '../src/lib/trade-view.core';
import {buildNeedsHivic} from '../src/lib/allocation.core';
import {crewSelectionProblems} from '../src/lib/piisa-crew.core';
import {prestartLocked,prestartFailedFor} from '../src/lib/prestart.core';
import {tradeSafeFailures} from '../src/lib/go-email.core';
import {addPersonProblems} from '../src/lib/team-screen.core';
import {teamMemberDetails,teamMissingDetails} from '../src/lib/team-required.core';

test('no White Card flags or prompts, even for stale stored missing states',()=>{
 expect(approvalFlags({trade_role:'installer'},'2026-11-05').some(x=>/white card/i.test(x))).toBe(false);
 expect(missingItems({trade_role:'installer'})).not.toContain('white_card');
 expect(teamWhiteCardLine('missing')).toBeNull();
});
test('existing uploaded White Card files remain readable as history',()=>{expect(whiteCardOf({white_card:{path:'workers/test/white-card.jpg',verified_at:'2026-11-01'}})?.path).toBe('workers/test/white-card.jpg');});
test('stale White Card Needs me inputs never raise a chase',()=>{
 const rows=buildNeedsHivic({now:new Date(),jobs:[{id:'test',job_number:'TEST',stage:'installation_booked',suburb:null}],coverageExhausted:[],releases:[],failedComms:[],rectDeclined:[],rectPricing:[],installerUnavailable:[],piesaTiming:[],evidenceRejected:[],registryQueries:[],officeOverdue:[],escTiming:[],prestart:{esc:[],failed:[],certs:[],whiteCards:[{job_id:'test',detail:'White Card missing'}]}} as never);
 expect(rows).toEqual([]);
});
test('stale crew White Card blockers no longer block Lead or Crew',()=>{
 const worker=(id:string)=>({workerId:id,name:id,eec:'CII-'+id,eecVerified:true,cleared:true,escRegistered:true,whiteCardBlocked:true});
 expect(crewSelectionProblems({lead:'lead',additional:[{workerId:'crew'}]},[worker('lead'),worker('crew')]).problems).toEqual([]);
});
test('historical White Card-only failed prestart no longer locks installation',()=>{
 expect(prestartLocked({start:'2026-11-10T00:00:00Z',now:new Date('2026-11-09T23:00:00Z'),latest:{scheduled_start:'2026-11-10T00:00:00Z',passed:false,failures:["Lead's White Card is missing"]}})).toEqual({locked:false,reasons:[]});
 expect(prestartFailedFor([{job_id:'test',scheduled_start:'2026-11-10T00:00:00Z'}],[{job_id:'test',scheduled_start:'2026-11-10T00:00:00Z',passed:false,failures:['White Card missing'],checked_at:'2026-11-09T00:00:00Z'}]).size).toBe(0);
});
test('partner email removes old White Card lines but preserves other blockers',()=>{
 expect(tradeSafeFailures([{line:'White Card missing',cls:'fixable'},{line:'Install deposit not paid',cls:'fixable'}])).toEqual([{line:'Install deposit not paid',cls:'fixable'}]);
});
const person={name:'TEST',mobile:'0412345678',dateOfBirth:null,ciiVerified:true,licenceRecVerified:true};
test('Lead still needs DOB for ESC',()=>{expect(requiredOnFileBlockers([{...person,role:'lead',dateOfBirth:false}])).toEqual(['TEST: date of birth missing']);});
test('Crew does not need DOB',()=>{expect(requiredOnFileBlockers([{...person,role:'crew',dateOfBirth:false}])).toEqual([]);});
test('electrician does not need DOB',()=>{expect(requiredOnFileBlockers([{...person,role:'electrician',dateOfBirth:false}])).toEqual([]);});
test('Crew add requires mobile, not DOB',()=>{
 expect(teamMemberDetails('installer',{mobile:'0412345678',email:null,dateOfBirth:null,workerRole:'crew'},'2026-11-05').ok).toBe(true);
 expect(addPersonProblems({name:'Test Crew',role:'crew',mobile:'0412345678',dateOfBirth:null,licenceNumber:null,recNumber:null},'2026-11-05')).toEqual([]);
 expect(teamMissingDetails('installer',{mobile:'0412345678',email:null,hasDateOfBirth:false,workerRole:'crew'})).toEqual([]);
});
test('electrician add requires mobile and email, not DOB',()=>{expect(teamMemberDetails('electrician',{mobile:'0412345678',email:'test@hivic-test.example',dateOfBirth:null},'2026-11-05').ok).toBe(true);});