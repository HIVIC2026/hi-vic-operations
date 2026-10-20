import { describe, expect, test } from 'bun:test';
import { catchupBlocker, catchupRoute, type CatchupFacts } from '../src/lib/office-first-response.core';
const safe: CatchupFacts = { jobNumber:'HV-3000',bucket:'enquiry',needsFirstResponse:true,source:'base44',channel:'hivic_sourced',stage:'preliminary_estimate_ready',email:'person@gmail.com',deleted:false,archived:false,removed:false,holdReason:null,answered:false,outbound:false,inFlight:false,recipientAnswered:false,consent:true,optedOut:false,suppressed:false,workActive:false,outcome:'needs_onsite_confirmation',decisionSource:'system',reviewRequired:false };
describe('Office-only catch-up safety',()=>{
  test('older preliminary_estimate_ready unanswered enquiry allowed',()=>expect(catchupBlocker(safe)).toBeNull());
  for (const flag of ['answered','outbound','recipientAnswered','inFlight','deleted','archived','removed','optedOut','suppressed','workActive','reviewRequired'] as const) test(`${flag} blocks`,()=>expect(catchupBlocker({...safe,[flag]:true})).not.toBeNull());
  test('missing consent blocks',()=>expect(catchupBlocker({...safe,consent:false})).toBe('Current contact consent missing'));
  for(const jobNumber of ['HV-2648','HV-2566'])test(`${jobNumber} explicitly excluded`,()=>expect(catchupBlocker({...safe,jobNumber})).toBe('Explicitly excluded by Jo'));
  for(const stage of ['on_hold','installation_booked','complete','cancelled'])test(`${stage} excluded`,()=>expect(catchupBlocker({...safe,stage})).not.toBeNull());
  test('hold reason blocks',()=>expect(catchupBlocker({...safe,holdReason:'Under five years'})).toBe('On hold'));
  test('active bucket excluded',()=>expect(catchupBlocker({...safe,bucket:'active'})).not.toBeNull());
  for(const email of ['broken','a@b','a@example.com','admin@hivic.test'])test(`invalid/test ${email}`,()=>expect(catchupBlocker({...safe,email})).not.toBeNull());
  test('qa source excluded',()=>expect(catchupBlocker({...safe,source:'qa_test'})).not.toBeNull());
});
const empty={excluded:false,received:false,uncertain:false,pendingSync:false,count:0};
test('no insulation routes offer only if likely',()=>{expect(catchupRoute('none','likely_eligible',empty)).toBe('offer');expect(catchupRoute('none','needs_onsite_confirmation',empty)).toBeNull()});
for(const insulation of ['present','unknown'])test(`${insulation} received vs empty`,()=>{expect(catchupRoute(insulation,'needs_onsite_confirmation',empty)).toBe('request');expect(catchupRoute(insulation,'needs_onsite_confirmation',{...empty,received:true,count:2})).toBe('acknowledge')});
test('uncertainty/pending never inferred absent',()=>{expect(catchupRoute('present','likely_eligible',{...empty,uncertain:true})).toBeNull();expect(catchupRoute('present','likely_eligible',{...empty,pendingSync:true})).toBeNull()});