import {expect,test} from 'bun:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {memoryPostgrest} from './helpers/memory-postgrest';
import {stableUuid} from '../src/lib/mitti-create-claim.core';
import {partnerEmailLayout} from '../src/lib/partner-email.core';
test('PIESA booked electrician gets one email with visit and owner details, not office or SMS',async()=>{
 const rows:any={jobs:[{id:'j',job_number:'HV-TEST',source:'base44',owner_id:'o',property_id:'p',deleted_at:null}],owners:[{id:'o',phone:'0412345678'}],properties:[{id:'p',address_line:'1 Practice St',suburb:'Richmond',postcode:'3121'}],bookings:[{id:'b',job_id:'j',kind:'assessment',status:'confirmed',contractor_id:'electrician',scheduled_start:'2026-11-10T22:00:00Z'}],partner_workers:[{id:'w',profile_id:'electrician',business_id:'biz',email:'worker@example.invalid',full_legal_name:'Pat Electrician',removed_at:null}],workflow_events:[]};
 const sends:any[]=[];const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:memoryPostgrest(rows)},'./mitti-create-claim.core':{stableUuid},'./partner-email.core':{partnerEmailLayout},'./trade-pause.server':{tradeMessagesPausedNow:async()=>null},'./qa-inbox.server':{qaDeliveryHeld:async()=>false},'./office-email.server':{sendOfficeEmail:async(p:any)=>{sends.push(p);return{status:'sent'};}}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/in-house-electrician-booked.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unexpected ${p}`);return deps[p];});
 await api.notifyInHouseElectricianBooked('j','b');await api.notifyInHouseElectricianBooked('j','b');expect(sends).toHaveLength(1);expect(sends[0].to).toBe('worker@example.invalid');expect(sends[0].text).toContain('0412345678');expect(sends[0].text).toContain('1 Practice St');expect(sends[0].text).toContain('9:00');
});