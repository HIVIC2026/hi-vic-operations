import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {memoryPostgrest} from './helpers/memory-postgrest';
import {stableUuid} from '../src/lib/mitti-create-claim.core';
test('recorded handback closes forms and revokes returned-business access without owner messages; retry once',async()=>{
 const rows:any={workflow_events:[{id:'back',job_id:'j',event_type:'in_house_pulled_back',details:{business_id:'biz',reason:'Too far'}}],jobs:[{id:'j',source:'base44'}],businesses:[{id:'biz',email:'office@example.invalid'}],partner_workers:[{id:'w',business_id:'biz',email:'worker@example.invalid',removed_at:null},{id:'outside',business_id:'other',email:'other@example.invalid',removed_at:null}]};
 const removed:any[]=[],closed:any[]=[];let failed=true;
 const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:memoryPostgrest(rows)},'./mitti-create-claim.core':{stableUuid},'./in-house-forms.server':{handbackFormIds:async()=>['RC','A3'],closeUnneededForms:async(...p:any[])=>{closed.push(p);return 2;}},'./mitti.server':{realMittiCall:()=>{},mittiCallFor:async()=>()=>{},findMittiUserByEmail:async(e:string)=>e},'./mitti.core':{mittiApi:()=>({removeInspectionUserAccess:async(audit:string,email:string)=>{if(failed){failed=false;throw Error('Mitti down');}removed.push([audit,email]);}})}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-handback-cleanup.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});
 await expect(api.finishInHouseHandback('j','actor')).rejects.toThrow('Mitti down');expect(rows.workflow_events.some((e:any)=>e.event_type==='in_house_form_sync_failed')).toBe(true);
 await api.finishInHouseHandback('j','actor');const count=removed.length;await api.finishInHouseHandback('j','actor');expect(removed).toHaveLength(count);expect(removed).toHaveLength(4);expect(removed.every((x:any)=>!x[1].includes('other'))).toBe(true);expect(closed.length).toBeGreaterThan(0);
});