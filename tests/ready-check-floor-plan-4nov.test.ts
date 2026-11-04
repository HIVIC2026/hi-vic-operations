import { expect, test } from 'bun:test';
import { parseAudit } from '../src/lib/mitti.core';
import { readLayoutArea } from '../src/lib/ceiling-layout.core';
import { areasFromReadyCheckEntries } from '../src/lib/area-diagram.core';
import { floorPlanFiles } from '../src/lib/ready-check-floor-plan.core';
const entries = [
 {label:'Name this area', value:'Whole house'},
 {label:'How did you measure this area?', value:'Floor plan'},
 {label:'Ceiling area from the floor plan (m²)', value:'148'},
 {label:'Upload the floor plan (photo or PDF)', value:'1 photo'},
 {label:'Old insulation in this area?', value:'None'},
];
test('plan m² supplies measured area, layout quantity and diagram without dimensions',()=>{
 const audit = {id:'plan-audit', items:[{id:'area',label:'Add a ceiling area',children:entries.map((e,i)=>({id:`q${i}`,label:e.label,responses:{text:e.value}}))}]};
 const r=parseAudit(audit);
 expect(r.patch.measured_area_m2).toBe(148); expect(r.areas[0]?.areaM2).toBe(148);
 expect(readLayoutArea(entries).m2).toBe(148); expect(areasFromReadyCheckEntries(entries)[0]?.areaM2).toBe(148);
 expect(r.areas[0]?.lengthM).toBeNull();
});
test('missing plan m² cannot fall back to stale hidden dimensions',()=>{
 const r=readLayoutArea(entries.filter(e=>!e.label.startsWith('Ceiling area from')).concat([{label:'Length (m)',value:'10'},{label:'Width (m)',value:'12'}]),120);
 expect(r.m2).toBeNull();
});
test('plan area is positive explicit input, never a parsed range or negative',()=>{
 for (const value of ['-148','about 148','100–148','0','']) expect(readLayoutArea(entries.map(e=>e.label.startsWith('Ceiling area from')?{...e,value}:e)).m2).toBeNull();
});
test('floor plan attachments retain actual media IDs, not an answered text placeholder',()=>{
 expect(floorPlanFiles({items:[{label:'Upload the floor plan (photo or PDF)',media:[{id:'plan-file',captured_at:'2026-11-04T00:00:00Z'}]}]}).map(f=>f.mediaId)).toEqual(['plan-file']);
 expect(floorPlanFiles({items:[{label:'Upload the floor plan (photo or PDF)',responses:{text:'1 photo'}}]})).toEqual([]);
});