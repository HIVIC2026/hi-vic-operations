import {expect,test} from 'bun:test';
import {installBeforePlan,installScopeChanges} from '../src/lib/install-before.core';
import {buildNeedsRows} from '../src/lib/office-needs.core';
import {installDayPrefillItems} from '../src/lib/install-day.core';
const area={name:'Main house',beforeVideo:true,wholeAreaPhoto:true,backingPhoto:true,depthPhoto:true,present:true,rejected:false};
test('accepted complete BEFORE evidence never asks again',()=>expect(installBeforePlan(true,[area]).needed).toEqual([]));
test('missing video requires only that area',()=>expect(installBeforePlan(true,[area,{...area,name:'Rear extension',beforeVideo:false}]).needed.map(a=>a.name)).toEqual(['Rear extension']));
test('old insulation without ruler requires recollection',()=>expect(installBeforePlan(true,[{...area,depthPhoto:false}]).needed[0]?.reasons).toContain('Old-insulation ruler photo missing'));
test('no old insulation never needs an old ruler',()=>expect(installBeforePlan(true,[{...area,present:false,depthPhoto:false}]).needed).toEqual([]));
test('office rejection requires that area regardless of presence',()=>expect(installBeforePlan(true,[{...area,rejected:true}]).needed[0]?.reasons).toContain('BEFORE evidence rejected by office'));
test('no Mitti Ready Check requires every area',()=>expect(installBeforePlan(false,[area,{...area,name:'Rear extension'}]).needed.length).toBe(2));
test('prefilled order is stable and names explicit',()=>expect(installBeforePlan(true,[area,{...area,name:'Rear extension'}]).areaOrder).toBe('1. Main house · 2. Rear extension'));
test('added area is scope review only, never pricing',()=>expect(installScopeChanges(['Main house'],[' main HOUSE ','Rear extension'])).toEqual(['Rear extension']));
test('scope change appears once in the office queue',()=>{
 const rows=buildNeedsRows({now:Date.parse('2026-11-04T00:00:00Z'),jobs:[{jobId:'test-job',jobNumber:'TEST',surname:'Test',suburb:null,installScopeChange:{at:'2026-11-04T00:00:00Z',areas:['Rear extension']}}]});
 expect(rows.today.filter(r=>r.kind==='install_scope_change').length).toBe(1);
});
test('area order uses a real unambiguous text item, not repeat-instance invention',()=>{
 const facts={jobNumber:null,address:null,installDate:null,apName:null,businessName:null,leadName:null,leadCii:null,lifeSupport:null,solarPresent:null,electricianAtStart:null,areaOrder:'1. Main house · 2. Rear extension'};
 const result=installDayPrefillItems({items:[{id:'order',label:'Ceiling areas in Ready Check order'}]},facts,()=>null);
 expect(result).toEqual([{item_id:'order',type:'text',responses:{text:'1. Main house · 2. Rear extension'}}]);
});