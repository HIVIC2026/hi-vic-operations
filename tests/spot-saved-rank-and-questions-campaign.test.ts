import {expect,test} from 'bun:test';
import {spotSavedRank,compareSpots,type SpotRankFacts} from '../src/lib/spot-saved-rank.core';
import {questionsExclusion,batchSlice,INSULATION_QUESTIONS_SEND_APPROVED,type QuestionsFacts} from '../src/lib/insulation-questions-campaign.core';
import {renderJoOutcomeEmail} from '../src/lib/jo-outcome-email.core';
const base:SpotRankFacts={reviewOutcome:null,hadUnclearReview:false,deskLooksEligible:false,declared:null,mediaCount:0,tapRoute:null,declaredThinPatchy:false};
test('Jo rank order 1–9',()=>{
 expect(spotSavedRank({...base,reviewOutcome:'no_insulation',mediaCount:2})).toBe(1);
 expect(spotSavedRank({...base,declared:'none',mediaCount:1})).toBe(2);
 expect(spotSavedRank({...base,reviewOutcome:'below_r2',mediaCount:3,declared:'present'})).toBe(3);
 expect(spotSavedRank({...base,reviewOutcome:'below_r2',mediaCount:3,hadUnclearReview:true})).toBe(4);
 expect(spotSavedRank({...base,reviewOutcome:'below_r2'})).toBe(4);
 expect(spotSavedRank({...base,declared:'none'})).toBe(5);
 expect(spotSavedRank({...base,declared:'present',tapRoute:'thin_patchy'})).toBe(6);
 expect(spotSavedRank({...base,declared:'present'})).toBe(7);
 expect(spotSavedRank({...base,declared:'unknown'})).toBe(8);
 expect(spotSavedRank(base)).toBe(9);
});
test('within a rank, longest waiting first',()=>{
 const xs=[{rank:2,spotSavedAt:'2026-10-20'},{rank:1,spotSavedAt:'2026-10-22'},{rank:2,spotSavedAt:'2026-10-01'}].sort(compareSpots);
 expect(xs.map(x=>x.spotSavedAt)).toEqual(['2026-10-22','2026-10-01','2026-10-20']);
});
const f:QuestionsFacts={source:'base44',channel:'hivic_sourced',stage:'preliminary_estimate_ready',outcome:'needs_onsite_confirmation',removed:false,optedOut:false,email:'a@b.c',duplicateContact:false,spotOffered:false,spotSaved:false,questionsSent:false,insulationDetailsSentAt:null,declared:'unknown',detail:null,tapAnswered:false,mediaCount:0};
const now=new Date('2026-10-23T08:00:00Z').getTime();
test('campaign audience includes don\'t know, present-without-details and no answer',()=>{
 expect(questionsExclusion(f,now)).toBeNull();
 expect(questionsExclusion({...f,declared:'present'},now)).toBeNull();
 expect(questionsExclusion({...f,declared:null},now)).toBeNull();
});
test('campaign exclusions',()=>{
 expect(questionsExclusion({...f,source:'qa_test'},now)).toBe('qa_test');
 expect(questionsExclusion({...f,stage:'cancelled'},now)).toBe('closed');
 expect(questionsExclusion({...f,optedOut:true},now)).toBe('opted_out');
 expect(questionsExclusion({...f,email:null},now)).toBe('no_email');
 expect(questionsExclusion({...f,spotOffered:true},now)).toBe('offered');
 expect(questionsExclusion({...f,spotSaved:true},now)).toBe('saved');
 expect(questionsExclusion({...f,questionsSent:true},now)).toBe('questions_sent');
 expect(questionsExclusion({...f,insulationDetailsSentAt:'2026-10-21T08:00:00Z'},now)).toBe('recent_details');
 expect(questionsExclusion({...f,insulationDetailsSentAt:'2026-10-19T08:00:00Z'},now)).toBeNull();
 expect(questionsExclusion({...f,declared:'none'},now)).toBe('said_none');
 expect(questionsExclusion({...f,declared:'present',detail:{insulation_type:'batts',insulation_thickness:'thin',insulation_coverage:'full'}},now)).toBe('details_known');
});
test('batches of 100 and sending off until Jo says go',()=>{
 const xs=Array.from({length:250},(_,i)=>i);
 expect(batchSlice(xs,1).length).toBe(100);expect(batchSlice(xs,3)).toEqual(xs.slice(200));
 expect(INSULATION_QUESTIONS_SEND_APPROVED).toBe(false);
});
test('email shows price, removal up-to line and the one questions button',()=>{
 const m=renderJoOutcomeEmail({outcome:'needs_onsite_confirmation',insulation:'unknown',ceilingSizeKnown:true,insulationQuestions:true,
  recipient:{firstName:'Sam',propertyAddress:'1 Test St, Mulgrave VIC 3170',enquiryReference:'HV-0000'},
  figures:{veuRebate:1200,customerTotal:2349,totalBeforeRebate:3549,installation:2851,piesaFee:349,apFee:349,ceilingAreaM2:120,areaEstimated:false,removalUpTo:1800},
  links:{saveMySpotUrl:null,uploadMediaUrl:'https://x/estimate/t/video',reviewResultUrl:'https://x',calculatorUrl:'https://x/c'}} as never)!;
 expect(m.html).toContain('Answer 3 quick questions to get your spot');
 expect(m.html).toContain('$1,800');
 expect(m.html).toContain('$2,349');
 expect(m.html).not.toContain('Save my spot →');
});
