import {expect,test} from 'bun:test';
import {onsiteAssessmentMember,onsiteInsulationLine,houseAgeLabel} from '../src/lib/onsite-assessment.core';
test('hand/thicker/cannot tell with 1991+ or not sure are in the group',()=>{
 for(const t of ['hand','thicker','unknown'] as const)for(const age of ['1991_1999','2000_2009','2010_or_later','unknown'] as const)
  expect(onsiteAssessmentMember({tap:{insulation_type:'batts',insulation_thickness:t,house_built_period:age},declaredInsulation:'present',mediaCount:0})).toBe(true);
});
test('1990 or earlier, loose fill and thin are not in the group',()=>{
 expect(onsiteAssessmentMember({tap:{insulation_type:'batts',insulation_thickness:'hand',house_built_period:'1990_or_earlier'},declaredInsulation:'present',mediaCount:0})).toBe(false);
 expect(onsiteAssessmentMember({tap:{insulation_type:'loose_fill',insulation_thickness:'thicker',house_built_period:'2000_2009'},declaredInsulation:'present',mediaCount:0})).toBe(false);
 expect(onsiteAssessmentMember({tap:{insulation_type:'batts',insulation_thickness:'thin',house_built_period:'2000_2009'},declaredInsulation:'present',mediaCount:0})).toBe(false);
});
test('type Not sure with no other answers is in the group',()=>{
 expect(onsiteAssessmentMember({tap:{insulation_type:'unknown'},declaredInsulation:'present',mediaCount:0})).toBe(true);
 expect(onsiteInsulationLine({insulation_type:'unknown'})).toBe('Not sure of type or thickness');
});
test('website "don\'t know" without photos is in; with photos, offered or "no insulation" it is out',()=>{
 expect(onsiteAssessmentMember({tap:null,declaredInsulation:'unknown',mediaCount:0})).toBe(true);
 expect(onsiteAssessmentMember({tap:null,declaredInsulation:'unknown',mediaCount:2})).toBe(false);
 expect(onsiteAssessmentMember({tap:null,declaredInsulation:'unknown',mediaCount:0,spotOffered:true})).toBe(false);
 expect(onsiteAssessmentMember({tap:null,declaredInsulation:'none',mediaCount:0})).toBe(false);
 expect(onsiteAssessmentMember({tap:null,declaredInsulation:'present',mediaCount:0})).toBe(false);
});
test('row wording',()=>{
 expect(onsiteInsulationLine(null)).toBe("Doesn't know if there's insulation");
 expect(onsiteInsulationLine({insulation_type:'batts',insulation_thickness:'hand'})).toBe("Batts (blanket strips) · About a hand's width");
 expect(houseAgeLabel({house_built_period:'2000_2009'})).toBe('2000–2009');
 expect(houseAgeLabel(null)).toBe('Age not given');
});
