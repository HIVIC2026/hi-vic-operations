import { expect, test } from 'bun:test';
import { FORMS, validateTemplate } from '../src/lib/mitti-forms.core';
import { parseAudit } from '../src/lib/mitti.core';
import { completionPlan } from '../src/lib/mitti-complete.core';
import { installBeforePlan } from '../src/lib/install-before.core';

const tick = "This job is ready to price. Everything I've filled in is correct. Any photos I skipped will be taken on install day.";
const measurement = { id:'m', status:'draft', external_source:'mitti', external_id:'a1', measured_area_m2:120, insulation_present:false, existing_r_value:null, removal_required:false, removal_m2:null, access_difficulty:'easy', review_flags:[] };
test('all A1 media optional without weakening answers or signature', () => {
  expect(FORMS.ready_check_priced.fields.filter(f=>f.type==='media').every(f=>f.required===false)).toBe(true);
  expect(FORMS.ready_check_priced.fields.find(f=>f.type==='signature')?.required).toBe(true);
});
test('rebuilt A1 requires the corrected ready-to-price tick', () => {
  const base = FORMS.ready_check_priced.fields.filter(f=>!f.portalOnly).map(f=>({label:f.label,type:f.type==='yesno'?'question':f.type==='number'?'number':f.type==='media'?'media':f.type==='signature'?'signature':f.type==='tick'?'checkbox':f.type==='choice'||f.type==='multichoice'?'question':'textsingle'}));
  const rebuilt=base.concat([{label:'Old insulation in this area?',type:'question'},{label:'Old insulation R value?',type:'question'}]).filter(f=>f.label!==tick);
  expect(validateTemplate('ready_check_priced',rebuilt).issues).toContain(`Missing: ${tick}`);
});
test('completed A1 with skipped media and the corrected tick completes; unticked does not', () => {
  const input={auditId:'a1',completed:true,modifiedAt:null,ourLead:false,websiteFacts:null,measurement};
  expect(completionPlan({...input,entries:[{label:tick,value:true}]}).kind).toBe('complete');
  expect(completionPlan({...input,entries:[{label:tick,value:false}]}).kind).toBe('hold');
});
test('old A1 without the new tick still completes',()=>expect(completionPlan({auditId:'a1',completed:true,modifiedAt:null,ourLead:false,websiteFacts:null,measurement,entries:[]}).kind).toBe('complete'));
test('optional A1 aerial photo does not hold measurement; A2 still flags missing upload',()=>{
  const audit={id:'a1',items:[{id:'area',label:'Add a ceiling area',children:[{id:'n',label:'Name this area',responses:{text:'Main house'}},{id:'how',label:'How did you measure this area?',responses:{text:'Aerial image'}},{id:'m2',label:'Ceiling area from the aerial image (m²)',responses:{text:'120'}},{id:'old',label:'Old insulation in this area?',responses:{text:'None'}}]}]};
  expect(parseAudit(audit,{installerSourced:true}).issues.some(i=>i.includes('file missing'))).toBe(false);
  expect(parseAudit(audit).issues.some(i=>i.includes('file missing'))).toBe(true);
  expect(parseAudit(audit,{installerSourced:true}).patch.measured_area_m2).toBe(120);
});
const area={name:'Main house',beforeVideo:true,wholeAreaPhoto:true,depthPhoto:true,backingPhoto:true,present:true,rejected:false};
test('missing whole-area photo requires install-day BEFORE evidence',()=>expect(installBeforePlan(true,[{...area,wholeAreaPhoto:false}]).needed.map(a=>a.name)).toEqual(['Main house']));
test('old insulation without backing photo requires install-day BEFORE evidence',()=>expect(installBeforePlan(true,[{...area,backingPhoto:false}]).needed.map(a=>a.name)).toEqual(['Main house']));
test('no old insulation does not require backing photo',()=>expect(installBeforePlan(true,[{...area,present:false,depthPhoto:false,backingPhoto:false}]).needed).toEqual([]));
test('job line lists only missing or rejected areas in Ready Check order',()=>{
  const result=installBeforePlan(true,[{...area,beforeVideo:false},{...area,name:'Rear extension',rejected:true},{...area,name:'Front bedroom'}]);
  expect(result.line).toBe('Before photos: to be taken on install day (Main house, Rear extension)');
});