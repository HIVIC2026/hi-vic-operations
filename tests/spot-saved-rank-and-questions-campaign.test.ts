import {expect,test} from 'bun:test';
import {spotSavedRank,compareSpots,type SpotRankFacts} from '../src/lib/spot-saved-rank.core';
import {existsSync,readFileSync} from 'node:fs';
import {INSULATION_QUESTIONS_SEND_APPROVED} from '../src/lib/insulation-questions-campaign.core';
import {renderJoOutcomeEmail} from '../src/lib/jo-outcome-email.core';
const base:SpotRankFacts={reviewOutcome:null,hadUnclearReview:false,deskLooksEligible:false,declared:null,mediaCount:0,tapRoute:null,declaredThinPatchy:false};
// Rank order 1–10 (Jo 08:14 UTC) lives in tests/everyone-gets-save-spot.test.ts.
test('within a rank, longest waiting first',()=>{
 const xs=[{rank:2,spotSavedAt:'2026-10-20'},{rank:1,spotSavedAt:'2026-10-22'},{rank:2,spotSavedAt:'2026-10-01'}].sort(compareSpots);
 expect(xs.map(x=>x.spotSavedAt)).toEqual(['2026-10-22','2026-10-01','2026-10-20']);
});
test('decision 180: automatic Save my spot after the 3 questions (spot-only wording approved by Jo 25 Oct 2026, decision 388); the office batch campaign is gone',()=>{
 expect(INSULATION_QUESTIONS_SEND_APPROVED).toBe(true);
 expect(existsSync('src/components/portal/InsulationQuestionsCampaign.tsx')).toBe(false);
 expect(readFileSync('src/lib/insulation-questions-campaign.server.ts','utf8')).not.toContain('questionsCampaignSendBatch');
 expect(readFileSync('src/lib/launch-campaign.functions.ts','utf8')).not.toContain('insulationQuestionsSendBatchFn');
 expect(readFileSync('src/lib/hot-leads-send.server.ts','utf8')).not.toContain('insulationQuestions?:');
});
test('email shows price, removal up-to line and the one questions button',()=>{
 const m=renderJoOutcomeEmail({outcome:'needs_onsite_confirmation',insulation:'unknown',ceilingSizeKnown:true,insulationQuestions:true,
  recipient:{firstName:'Sam',propertyAddress:'1 Test St, Mulgrave VIC 3170',enquiryReference:'HV-0000'},
  figures:{veuRebate:1200,customerTotal:2349,totalBeforeRebate:3549,installation:2851,piesaFee:349,apFee:349,ceilingAreaM2:120,areaEstimated:false,removalUpTo:1800},
  links:{saveMySpotUrl:null,uploadMediaUrl:'https://x/estimate/t/video',reviewResultUrl:'https://x',calculatorUrl:'https://x/c'}} as never)!;
 expect(m.html).toContain('Answer &amp; save my spot'); // decision 69 button
 expect(m.html).toContain('What type is it?');
 expect(m.html).toContain('$1,800');
 expect(m.html).toContain('$2,349');
 expect(m.html).not.toContain('Save my spot →');
 expect(m.subject).toBe('Sam, you may qualify for $1,200 off ceiling insulation'); // MJML refresh: subject matches the heading
 // Decision 392: a "don't know" owner is never told "You told us there's some insulation".
 expect(m.html).toContain("You weren't sure if there's insulation in your ceiling.");
 expect(m.html).not.toContain("You told us there's some insulation");
 expect(m.html).toContain('existing insulation not known yet');
});
