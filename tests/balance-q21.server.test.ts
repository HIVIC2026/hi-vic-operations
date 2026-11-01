import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {memoryPostgrest} from './helpers/memory-postgrest';
import * as core from '../src/lib/balance-q21.core';
function load(path:string,deps:Record<string,unknown>){const api:Record<string,any>={};new Function('exports','require',ts.transpile(readFileSync(path,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}))(api,(name:string)=>{if(!(name in deps))throw Error(`Unmocked ${name}`);return deps[name];});return api;}
test('Q21 actual sweep captures day5/due once, skips paid, retries invoice date and never contacts providers',async()=>{
 const rows={jobs:[{id:'j',stage:'evidence_outstanding',installation_completed_at:'2026-11-01T23:00:00Z',deleted_at:null}]};
 const keys=new Set<string>(),captured:string[]=[];let paid=false,dates=0;
 const api=load('src/lib/balance-q21.server.ts',{'@/integrations/supabase/client.server':{supabaseAdmin:memoryPostgrest(rows)},'./balance-q21.core':core,'./payments.core':{isStepPaid:()=>paid},'./payments.server':{jobPaymentView:async()=>({invoices:{install:{id:'i'}},steps:[]})},'./invoice-dates.server':{setCompletedBalanceDueDate:async()=>dates++},'./mail-mjml.core':{genericMail:()=>'<captured>'},'./owner-template-send.server':{sendOwnerTemplateEmail:async(p:any)=>{if(keys.has(p.key))return 'duplicate';keys.add(p.key);captured.push(p.render({myJobUrl:'https://example.invalid/my-job/test'}).subject);return 'sent';}}});
 await api.sweepBalanceQ21(new Date('2026-11-06T23:00:00Z'));await api.sweepBalanceQ21(new Date('2026-11-06T23:00:00Z'));
 await api.sweepBalanceQ21(new Date('2026-11-08T23:00:00Z'));paid=true;await api.sweepBalanceQ21(new Date('2026-11-08T23:00:00Z'));
 expect(captured).toEqual(['Your balance is due in 2 days','Your balance is due today']);expect(dates).toBe(4);
});