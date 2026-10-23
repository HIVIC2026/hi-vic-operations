import { expect,test } from 'vitest';
import {existingInsulationTemplateFacts} from '../src/lib/existing-insulation-template.core';
import {selectJoOutcomeTemplate} from '../src/lib/jo-outcome-email.core';
test('all present and unknown descriptions get an authorized offer without claiming photo review',()=>{
 for(const insulation of ['present','unknown']) for(const type of ['loose_fill','batts','unknown',null]) for(const thickness of ['thin','hand','thicker','unknown',null]) for(const coverage of ['whole','partial','unknown',null]) {
  const r=existingInsulationTemplateFacts({insulation,type,thickness,coverage,authorized:true,reviewOutcome:null,readFailed:false});expect(r.declaredExisting||r.declaredThinPatchy).toBe(true);
  for(const outcome of ['likely_eligible','needs_onsite_confirmation'] as const) for(const ceilingSizeKnown of [true,false]) expect(selectJoOutcomeTemplate({outcome,insulation:insulation as 'present'|'unknown',ceilingSizeKnown,...r})).toBe(ceilingSizeKnown?'eligible_no_insulation_size_known':'eligible_no_insulation_size_unknown');
 }
});
test('approval, readable evidence and existing office decisions remain guards',()=>{
 for(const reviewOutcome of ['over_r2','unclear','below_r2','no_insulation']) expect(existingInsulationTemplateFacts({insulation:'present',authorized:true,reviewOutcome,readFailed:false})).toEqual({declaredThinPatchy:false,declaredExisting:false});
 expect(existingInsulationTemplateFacts({insulation:'unknown',authorized:false,reviewOutcome:null,readFailed:false}).declaredExisting).toBe(false);
 expect(existingInsulationTemplateFacts({insulation:'present',authorized:true,reviewOutcome:null,readFailed:true}).declaredExisting).toBe(false);
});