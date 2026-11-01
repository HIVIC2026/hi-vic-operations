import {expect,test} from 'bun:test';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {memoryPostgrest} from './helpers/memory-postgrest';
import * as consent from '../src/lib/consent.core';
import * as assignment from '../src/lib/assignment.core';
import {requestContext,runAfterResponse} from '../src/lib/background.server';
function fixture(){
 const rows:any={owner_esc_consents:[{id:'c',job_id:'j',version:1,status:'awaiting_owner',owner_signed_at:null,template_version:'ESC v1 20260414',section1:{first_name:'Practice',last_name:'Owner',installation_address:'1 Practice St',phone:'',email:''}}],compliance_templates:[{template_key:'esc_consent',version:'ESC v1 20260414',approved:true,is_active:true,body:'Practice only'}]};
 const db=memoryPostgrest(rows);let complete=0;let release=()=>{};const wait=new Promise<void>(r=>release=r),queued:Promise<unknown>[]=[];
 const deps:any={'@/integrations/supabase/client.server':{supabaseAdmin:db},'./workflow.server':{WorkflowError:Error,logEvent:async()=>{}},'./consent.core':{...consent,ownerConsentBlockers:()=>[]},'./assignment.core':assignment,'./assignment.server':{buildAcceptancePackage:async()=>({consumer:{name:'Practice Owner'},property_address:'1 Practice St'})},'./background.server':{runAfterResponse},'./consent-ap-auto.server':{tryAutoConsentApSignature:async()=>{await wait;complete++;}},'./address':{formatPropertyAddress:()=> '1 Practice St'}};
 const api:any={};new Function('exports','require',ts.transpile(readFileSync('src/lib/consent.server.ts','utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(p:string)=>{if(!(p in deps))throw Error(`Unmocked ${p}`);return deps[p];});
 return{api,rows,queued,release,complete:()=>complete};
}
test('quote consent acknowledges durable owner signature without waiting for AP PDF/email; sweep state remains retryable',async()=>{
 const f=fixture();const start=performance.now();const response=requestContext.run({waitUntil:p=>f.queued.push(p)},()=>f.api.signOwnerConsent({jobId:'j',actorId:'owner',input:{signatoryName:'Practice Owner',signatureName:'Practice Owner',authorityType:'owner',accept:true,declarations:{owner_or_authorised:true,details_accurate:true,consent_ap_sends:true,consent_commission_shares:true}},ip:null,userAgent:null}));
 const result=await Promise.race([response.then(()=> 'returned'),new Promise(r=>setTimeout(()=>r('blocked'),80))]);f.release();await response;await Promise.all(f.queued);
 expect(result).toBe('returned');expect(f.rows.owner_esc_consents[0].owner_signed_at).toBeTruthy();expect(f.rows.owner_esc_consents[0].status).toBe('awaiting_ap');expect(f.complete()).toBe(1);console.log(`S1 quote consent response: ${(performance.now()-start).toFixed(1)}ms (blocked provider double)`);
});
