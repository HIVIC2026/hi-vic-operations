import { expect, test } from 'bun:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/integrations/supabase/types';
import { loadOperationsPreview } from '../src/lib/operations-preview.server';
type Call = { table: string; methods: { name: string; args: unknown[] }[] };
function mock(rows: Record<string, unknown[]> = {}, settings: Record<string, unknown> | null = {customer_comms_enabled:false}, errorTable?:string) {
  const calls: Call[]=[];
  const client={from(table:string) {
    const call:Call={table,methods:[]}; calls.push(call);
    const q: Record<string, unknown>={};
    for(const name of ['select','eq','neq','or','in','not','is','order','range','maybeSingle']) q[name]=(...args:unknown[])=>{call.methods.push({name,args});return q;};
    q.then=(resolve:(v:unknown)=>unknown)=>{
      let data:unknown=rows[table]??[];
      if(table==='workflow_settings')data=settings;
      if(table==='customer_delivery_settings')data={enabled:true};
      return Promise.resolve(resolve({data,error:table===errorTable?{message:'TEST read failure'}:null}));
    };
    return q;
  }} as unknown as SupabaseClient<Database>;
  return {client,calls};
}
const job={id:'test-job',job_number:'TEST',stage:'preliminary_estimate_ready',source:null,channel:null,business_unit:'hivic',created_at:'2026-10-01',owners:{full_name:'TEST'},properties:{}};
test('loader uses SELECT only, retains null sources and bounds every child by scoped IDs',async()=>{
  const {client,calls}=mock({jobs:[job]});const result=await loadOperationsPreview(client);
  expect(result.rows).toHaveLength(1);expect(result.totals['Needs classification']).toBe(1);
  const jobs=calls.find(c=>c.table==='jobs');
  expect(jobs?.methods).toContainEqual({name:'eq',args:['business_unit','hivic']});
  expect(jobs?.methods).toContainEqual({name:'or',args:['source.is.null,source.neq.qa_test']}); expect(jobs?.methods).toContainEqual({name:'is',args:['deleted_at',null]});
  for(const c of calls){
    expect(c.methods.every(m=>['select','eq','neq','or','in','not','is','order','range','maybeSingle'].includes(m.name))).toBe(true);
    if(!['jobs','workflow_settings','customer_delivery_settings','businesses'].includes(c.table)) expect(c.methods).toContainEqual({name:'in',args:['job_id',['test-job']]});
  }
  expect(result.controls.find(c=>c.label==='Insulation-details email')?.state).toBe('Paused');
  const proof=calls.find(c=>c.table==='customer_email_sends');expect(String(proof?.methods[0]?.args[0])).toContain('idempotency_key');
  expect(String(calls.find(c=>c.table==='evidence_requirements')?.methods[0]?.args[0])).toContain('gate');
});
test('missing settings remain unknown and failures surface instead of zero totals',async()=>{
  const m=mock({jobs:[job]},null);expect((await loadOperationsPreview(m.client)).controls.find(c=>c.label==='Insulation-details email')?.state).toBe('Unknown');
  const failed=mock({jobs:[job]},undefined,'evidence_requirements');await expect(loadOperationsPreview(failed.client)).rejects.toThrow('evidence requirements could not load');
});
test('loader carries gate and action identity and ignores old failed email after success',async()=>{
  const m=mock({jobs:[{...job,source:'website',channel:'hivic_sourced',eligibility_outcome:'likely_eligible',properties:{enrichment:{base44:{raw:{answers:{existing_insulation:'none'}}}}}}],evidence_requirements:[{job_id:'test-job',label:'PIISA',gate:'installation',status:'outstanding'}],customer_email_sends:[{job_id:'test-job',purpose:'step3_estimate',status:'failed',created_at:'2026-10-01',error:'TEST error'},{job_id:'test-job',purpose:'step3_estimate',status:'sent',sent_at:'2026-10-02',created_at:'2026-10-02'}]});
  const r=(await loadOperationsPreview(m.client)).rows[0];expect(r?.evidence[0]?.gate).toBe('installation');expect(r?.failures.join(' ')).not.toContain('Customer');expect(r?.communications).toHaveLength(2);
});
test('single-job load filters the jobs read by id before related facts',async()=>{
  const {client,calls}=mock({jobs:[{...job,id:'job-1',job_number:'HV-1'}]});
  const result=await loadOperationsPreview(client,'job-1');
  expect(result.rows).toHaveLength(1);expect(result.rows[0]?.id).toBe('job-1');
  const jobs=calls.find(c=>c.table==='jobs');
  expect(jobs?.methods).toContainEqual({name:'eq',args:['id','job-1']});
  // Scoping unchanged: business unit, deleted and TEST/source exclusions still applied.
  expect(jobs?.methods).toContainEqual({name:'eq',args:['business_unit','hivic']});
  expect(jobs?.methods).toContainEqual({name:'or',args:['source.is.null,source.neq.qa_test']});
  expect(jobs?.methods).toContainEqual({name:'is',args:['deleted_at',null]});
  // Every related-fact family is still bounded to exactly the chosen job.
  for(const c of calls){
    if(!['jobs','workflow_settings','customer_delivery_settings','businesses'].includes(c.table))
      expect(c.methods).toContainEqual({name:'in',args:['job_id',['job-1']]});
  }
});
test('single-job classification matches the full-dashboard semantics for the same job',async()=>{
  const full={...job,id:'job-1',job_number:'HV-1',source:'website',channel:'hivic_sourced',eligibility_outcome:'likely_eligible',properties:{enrichment:{base44:{raw:{answers:{existing_insulation:'none'}}}}}};
  const other={...job,id:'job-2',job_number:'HV-2',source:'website',channel:'hivic_sourced',eligibility_outcome:'likely_eligible',properties:{enrichment:{base44:{raw:{answers:{existing_insulation:'none'}}}}}};
  const whole=(await loadOperationsPreview(mock({jobs:[full,other]}).client)).rows.find(r=>r.id==='job-1');
  const single=(await loadOperationsPreview(mock({jobs:[full]}).client,'job-1')).rows[0];
  expect(single).toEqual(whole);
});
test('single-job load stays fail-closed: excluded or unknown jobs yield no row',async()=>{
  // The classifier excludes qa_test sources even if a read returns them.
  const qa=await loadOperationsPreview(mock({jobs:[{...job,id:'job-qa',source:'qa_test',channel:'hivic_sourced'}]}).client,'job-qa');
  expect(qa.rows).toHaveLength(0);
  const missing=await loadOperationsPreview(mock({jobs:[]}).client,'job-x');
  expect(missing.rows).toHaveLength(0);
  // A read failure still throws rather than reporting a not-found job.
  const failed=mock({jobs:[job]},undefined,'evidence_requirements');
  await expect(loadOperationsPreview(failed.client,'test-job')).rejects.toThrow('evidence requirements could not load');
});
