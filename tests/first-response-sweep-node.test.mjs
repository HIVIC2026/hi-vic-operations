// Runs the ACTUAL TypeScript worker/hook through Node's type stripper. Only I/O boundaries are replaced.
// This checks the worker protocol, not PostgreSQL: the separate PGlite suite exercises the real migration.
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadActualSweep as loadSweep, sweepEligible, readActualSource as read, stripActualTypeScript } from './helpers/load-first-response-sweep.mjs';

const held = () => ({ sent: false, route: 'none', reason: 'media still ambiguous' });
const sent = () => ({ sent: true, route: 'request_insulation', reason: 'sent' });
const job = (n, overrides = {}) => ({
  job_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, job_number: `HV-${3000+n}`,
  created_at: new Date(Date.now() - 3_600_000 + n).toISOString(), needs_first_response: true,
  office_bucket: 'enquiry', source: 'base44', channel: 'hivic_sourced', business_unit: 'hivic', ...overrides,
});

class RetryBoundary {
  now = Date.now(); ledger = new Map(); events = []; calls = []; routed = []; failures = new Map();
  rules = { state: 'ok', config: { enabled: true, activatedAt: new Date(Date.now() - 86_400_000).toISOString() } };
  route = async () => held(); onClaim = null;
  constructor(jobs) { this.jobs = jobs; }
  eligible(j, active) {
    return sweepEligible(j, active, this.now) && Date.parse(j.created_at) <= this.now &&
      j.channel === 'hivic_sourced' && j.business_unit === 'hivic' && !j.activeWork && !j.manualBacklog;
  }
  fence(args) {
    const r = this.ledger.get(args.p_job_id);
    if (!r || r.claim_token !== args.p_claim_token || r.lease_until <= this.now) throw new Error('claim expired or was taken over');
    return r;
  }
  async rpc(name, args) {
    this.calls.push(name);
    try {
      if (this.failures.has(name)) throw new Error(this.failures.get(name));
      if (name === 'claim_first_response_retries') {
        const due = this.jobs.filter(j => {
          const r = this.ledger.get(j.job_id);
          return this.eligible(j, args.p_activated_at) && r?.last_outcome !== 'sent' &&
            (!r || (r.next_attempt_at <= this.now && (!r.claim_token || r.lease_until <= this.now)));
        }).sort((a,b) => (this.ledger.get(a.job_id)?.next_attempt_at ?? Date.parse(a.created_at)) -
          (this.ledger.get(b.job_id)?.next_attempt_at ?? Date.parse(b.created_at)) || a.job_id.localeCompare(b.job_id)).slice(0,args.p_limit);
        const data = due.map(j => {
          const old = this.ledger.get(j.job_id);
          const r = { ...old, claim_token: randomUUID(), lease_until: this.now + 600_000,
            next_attempt_at: this.now + 600_000, attempt_count: (old?.attempt_count ?? 0) + 1 };
          this.ledger.set(j.job_id,r); return { ...j, claim_token:r.claim_token };
        });
        this.onClaim?.();
        return {data,error:null};
      }
      if (name === 'start_first_response_retry') {
        const r=this.fence(args), j=this.jobs.find(j => j.job_id===args.p_job_id);
        if (!j || !this.eligible(j,args.p_activated_at)) return {data:false,error:null};
        r.lease_until=r.next_attempt_at=this.now+600_000;
        return {data:true,error:null};
      }
      if (name === 'finish_first_response_retry') {
        const r=this.fence(args);
        if (args.p_outcome==='held' && (r.last_outcome!=='held' || r.last_reason!==args.p_reason || r.last_route!==args.p_route)) {
          this.events.push({job_id:args.p_job_id,reason:args.p_reason,internal:true});
        }
        Object.assign(r,{claim_token:null,lease_until:null,last_outcome:args.p_outcome,last_reason:args.p_reason,last_route:args.p_route,
          next_attempt_at:this.now+Math.min(3_600_000,120_000 * 2**Math.min(r.attempt_count-1,5))});
        return {data:true,error:null};
      }
      throw new Error('Unexpected RPC: '+name);
    } catch(e) { return {data:null,error:{message:e.message}}; }
  }
  sweep() {
    return loadSweep({ admin:{rpc:this.rpc.bind(this)}, sweepEligible, load:async name => {
      if(name==='./save-spot-rules.server') return {readAutomaticRules:async()=>this.rules};
      if(name==='./lead-email-routing.server') return {maybeAutoRouteLeadEmail:async id=>{this.routed.push(id);return this.route(id);}};
      throw new Error('Unexpected import: '+name);
    }});
  }
}

test('actual worker: five permanently held oldest jobs do not starve the sixth on later runs', async () => {
  const rows=Array.from({length:6},(_,i)=>job(i+1)), io=new RetryBoundary(rows);
  io.route=async id=>id===rows[5].job_id?sent():held();
  assert.deepEqual(await io.sweep()(),{checked:5,sent:0});
  assert.deepEqual(await io.sweep()(),{checked:1,sent:1});
  assert.deepEqual(await io.sweep()(),{checked:0,sent:0});
  assert.equal(new Set(io.routed).size,6); assert.equal(io.events.length,5);
});

test('actual worker consumes a bounded claim; old active/excluded/invalid entries cannot fill a look-ahead page', async () => {
  const blocked=Array.from({length:60},(_,i)=>job(i+1,{activeWork:true}));
  blocked.push(job(61,{job_number:'HV-2566'}),job(62,{job_number:'HV-2648'}),job(63,{channel:'installer_sourced'}),job(64,{business_unit:'other'}));
  const target=job(65), io=new RetryBoundary([...blocked,target]); io.route=async()=>sent();
  assert.deepEqual(await io.sweep()(),{checked:1,sent:1}); assert.deepEqual(io.routed,[target.job_id]);
});

test('actual worker preserves durable backoff and records a held reason only when changed', async () => {
  const j=job(1), io=new RetryBoundary([j]);
  await io.sweep()(); assert.equal(io.ledger.get(j.job_id).next_attempt_at-io.now,120_000);
  await io.sweep()(); assert.equal(io.routed.length,1);
  io.now+=121_000; await io.sweep()(); assert.equal(io.ledger.get(j.job_id).next_attempt_at-io.now,240_000);
  assert.equal(io.events.length,1);
  io.now+=241_000; io.route=async()=>({...held(),reason:'provider confirmed failure'}); await io.sweep()();
  assert.equal(io.events.length,2);
});

test('two overlapping actual workers use disjoint claims and route each job once', async () => {
  const io=new RetryBoundary(Array.from({length:6},(_,i)=>job(i+1)));
  await Promise.all([io.sweep()(),io.sweep()()]);
  assert.equal(io.routed.length,6); assert.equal(new Set(io.routed).size,6);
});

test('database failure on claim or immediate safety recheck fails closed before routing', async () => {
  for(const name of ['claim_first_response_retries','start_first_response_retry']) {
    const io=new RetryBoundary([job(1)]); io.failures.set(name,'database unavailable');
    await assert.rejects(io.sweep()(),/database unavailable/); assert.equal(io.routed.length,0);
  }
});

test('intake becoming active after a claim prevents routing and records the hold', async () => {
  const j=job(1), io=new RetryBoundary([j]); io.onClaim=()=>{j.activeWork=true;};
  assert.deepEqual(await io.sweep()(),{checked:0,sent:0}); assert.equal(io.routed.length,0);
  assert.match(io.events[0].reason,/intake is still active/);
});

test('failure recording a held reason is not swallowed and stops further routes in this batch', async () => {
  const io=new RetryBoundary([job(1),job(2)]); io.failures.set('finish_first_response_retry','audit write failed');
  await assert.rejects(io.sweep()(),/audit write failed/); assert.equal(io.routed.length,1);
  assert.equal(io.events.length,0); assert.ok(io.ledger.get(job(1).job_id).claim_token);
});

test('provider acceptance followed by ledger failure is not an unconditional send retry', async () => {
  const j=job(1), io=new RetryBoundary([j]);
  io.route=async()=>{j.needs_first_response=false;return sent();};
  io.failures.set('finish_first_response_retry','ledger unavailable');
  await assert.rejects(io.sweep()(),/ledger unavailable/);
  io.failures.clear(); io.now+=601_000;
  assert.deepEqual(await io.sweep()(),{checked:0,sent:0}); assert.equal(io.routed.length,1);
});

test('router errors remain visible after a durable hold; no later job is routed', async () => {
  const io=new RetryBoundary([job(1),job(2)]); io.route=async()=>{throw new Error('guard read failed');};
  await assert.rejects(io.sweep()(),/guard read failed/); assert.equal(io.routed.length,1);
  assert.match(io.events[0].reason,/router failed/);
});

test('unreadable/invalid rules are visible; disabled or unactivated rules do not claim', async () => {
  for(const state of ['unreadable','invalid','missing']) {
    const io=new RetryBoundary([job(1)]);io.rules={state,reason:'rules unavailable'};
    await assert.rejects(io.sweep()(),/rules unavailable/);assert.equal(io.calls.length,0);
  }
  for(const config of [{enabled:false,activatedAt:new Date().toISOString()},{enabled:true,activatedAt:null}]) {
    const io=new RetryBoundary([job(1)]);io.rules={state:'ok',config};
    assert.deepEqual(await io.sweep()(),{checked:0,sent:0});assert.equal(io.calls.length,0);
  }
});

test('bounds reject zero, fractional, nonfinite and oversized limits before any database call', async () => {
  const io=new RetryBoundary([job(1)]);
  for(const limit of [0,-1,1.5,6,Infinity,NaN]) await assert.rejects(io.sweep()(limit),/between 1 and 5/);
  assert.equal(io.calls.length,0);
});

test('actual hook reports sweep failure as 500 while preserving completed intake results and authentication', async () => {
  const source=read('src/routes/api/public/hooks/post-intake.ts');
  const logs=[];let intakeCalls=0;
  const deps={console:{error:(...args)=>logs.push(args)},denied:null,
    async load(name){
      if(name==='@/lib/postintake.server') return {processPostIntakeWork:async()=>{intakeCalls++;return {recovered:2,claimed:3,results:[{status:'done'}]};},recordWorkerRun:async()=>{}};
      if(name==='@/lib/allocation.server') return {sweepRecOffers:async()=>{},sweepCoordination:async()=>{}};
      if(name==='@/lib/first-response-sweep.server') return {sweepUnansweredFirstResponses:async()=>{throw new Error('ledger unavailable');}};
      throw new Error('Unexpected import: '+name);
    }};
  const adapted=source
    .replace('import { createFileRoute } from "@tanstack/react-router";','const createFileRoute = () => value => value;')
    .replace('import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";','const authenticateCronRequest = async () => deps.denied;')
    .replaceAll(/import\("([^"]+)"\)/g,'deps.load("$1")');
  const js=stripActualTypeScript(adapted).replaceAll(/^export /gm,'');
  const route=new Function('deps','const console=deps.console;\n'+js+'\nreturn Route;')(deps);
  const response=await route.server.handlers.POST({request:new Request('https://example.invalid/hook',{method:'POST'})});
  assert.equal(response.status,500);const body=await response.json();
  assert.equal(body.ok,false);assert.equal(body.recovered,2);assert.equal(body.claimed,3);assert.deepEqual(body.results,[{status:'done'}]);
  assert.match(logs[0].join(' '),/first-response sweep failed.*ledger unavailable/);
  deps.denied=new Response('Unauthorized',{status:401});
  assert.equal((await route.server.handlers.POST({request:new Request('https://example.invalid/hook',{method:'POST'})})).status,401);
  assert.equal(intakeCalls,1);
});
