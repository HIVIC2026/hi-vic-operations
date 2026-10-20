// Executes the ACTUAL pending migration and ACTUAL worker in a disposable embedded PostgreSQL database.
// The view fixture preserves its public contract; the full office enquiry classifier and senders have separate suites.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadActualSweep, readActualSource, testRequire } from './helpers/load-first-response-sweep.mjs';
const { PGlite } = testRequire('@electric-sql/pglite');
const migration = readActualSource('docs/pending-migrations/XXXX_first_response_retry_ledger.sql');
const rollback = readActualSource('docs/pending-migrations/XXXX_first_response_retry_ledger.rollback.sql');

const schema = `
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE TABLE public.jobs (
    id uuid PRIMARY KEY, job_number text NOT NULL, created_at timestamptz NOT NULL,
    source text NOT NULL DEFAULT 'base44', channel text NOT NULL DEFAULT 'hivic_sourced',
    business_unit text NOT NULL DEFAULT 'hivic', stage text NOT NULL DEFAULT 'new_enquiry',
    deleted_at timestamptz, qa_archived_at timestamptz,
    office_bucket text NOT NULL DEFAULT 'enquiry', needs_first_response boolean NOT NULL DEFAULT true
  );
  CREATE VIEW public.office_enquiry_index AS
    SELECT id, job_number, created_at, source, channel, office_bucket, needs_first_response FROM public.jobs;
  CREATE TABLE public.post_intake_work (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id),
    status text NOT NULL, reason text, facts_version text
  );
  CREATE TABLE public.workflow_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES public.jobs(id),
    actor_id uuid, event_type text NOT NULL, summary text NOT NULL, details jsonb,
    internal boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
  );`;

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const held = reason => ({ sent: false, route: 'none', reason: reason ?? 'media still ambiguous' });
const sent = () => ({ sent: true, route: 'request_insulation', reason: 'sent' });
const serialize = value => JSON.parse(JSON.stringify(value));

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(schema); await db.exec(migration);
  const active = new Date(Date.now() - 86_400_000).toISOString();
  const io = { db, active, routed: [], afterClaim: null, route: async () => held() };
  io.add = async (n, changes = {}) => {
    const row = { id:id(n), job_number:`HV-${3000+n}`, created_at:new Date(Date.now() - 3_600_000 + n).toISOString(), ...changes };
    const allowed = new Set(['id','job_number','created_at','source','channel','business_unit','stage','deleted_at','qa_archived_at','office_bucket','needs_first_response']);
    const entries = Object.entries(row);
    for (const [key] of entries) assert.ok(allowed.has(key), `Unknown fixture field ${key}`);
    await db.query(`INSERT INTO public.jobs (${entries.map(([key])=>key).join(',')}) VALUES (${entries.map((_,i)=>'$'+(i+1)).join(',')})`,entries.map(([,value])=>value));
    return row;
  };
  io.claim = async (limit=5) => (await db.query('SELECT * FROM public.claim_first_response_retries($1,$2)',[active,limit])).rows;
  io.start = async claim => (await db.query('SELECT public.start_first_response_retry($1,$2,$3) AS result',[claim.job_id,claim.claim_token,active])).rows[0].result;
  io.finish = async (claim,outcome='held',reason='media still ambiguous',route='none') =>
    (await db.query('SELECT public.finish_first_response_retry($1,$2,$3,$4,$5) AS result',[claim.job_id,claim.claim_token,outcome,route,reason])).rows[0].result;
  io.rpc = async (name,args) => {
    try {
      let data;
      if (name==='claim_first_response_retries') {
        data=(await db.query('SELECT * FROM public.claim_first_response_retries($1,$2)',[args.p_activated_at,args.p_limit])).rows;
        await io.afterClaim?.(data);
      } else if (name==='start_first_response_retry') {
        data=(await db.query('SELECT public.start_first_response_retry($1,$2,$3) AS result',[args.p_job_id,args.p_claim_token,args.p_activated_at])).rows[0].result;
      } else if (name==='finish_first_response_retry') {
        data=(await db.query('SELECT public.finish_first_response_retry($1,$2,$3,$4,$5) AS result',
          [args.p_job_id,args.p_claim_token,args.p_outcome,args.p_route,args.p_reason])).rows[0].result;
      } else throw new Error('Unexpected RPC: '+name);
      return {data:serialize(data),error:null};
    } catch(error) { return {data:null,error:{message:error.message}}; }
  };
  io.sweep = loadActualSweep({admin:{rpc:io.rpc},load:async name=>{
    if(name==='./save-spot-rules.server') return {readAutomaticRules:async()=>({state:'ok',config:{enabled:true,activatedAt:active}})};
    if(name==='./lead-email-routing.server') return {maybeAutoRouteLeadEmail:async jobId=>{io.routed.push(jobId);return io.route(jobId);}};
    throw new Error('Unexpected import: '+name);
  }});
  return io;
}

test('actual SQL + actual worker: oldest five held entries cannot starve the sixth', async t=>{
  const io=await fixture(t);for(let n=1;n<=6;n++) await io.add(n);
  io.route=async jobId=>jobId===id(6)?sent():held();
  assert.deepEqual(await io.sweep(),{checked:5,sent:0});
  assert.deepEqual(await io.sweep(),{checked:1,sent:1});
  assert.deepEqual(await io.sweep(),{checked:0,sent:0});
  assert.equal(new Set(io.routed).size,6);
  assert.equal((await io.db.query('SELECT * FROM first_response_retries')).rows.length,6);
  const events=(await io.db.query('SELECT * FROM workflow_events')).rows;
  assert.equal(events.length,5);assert.ok(events.every(e=>e.internal&&e.event_type==='automatic_first_response_held'));
});

test('actual SQL filters active intake, manual backlog and invalid scope before the bounded claim', async t=>{
  const io=await fixture(t);
  for(let n=1;n<=60;n++) {
    await io.add(n);
    await io.db.query('INSERT INTO post_intake_work(job_id,status) VALUES($1,$2)',[id(n),['queued','processing','retry'][n%3]]);
  }
  const invalid=[{job_number:'HV-2566'},{job_number:'HV-2648'},{channel:'installer_sourced'},
    {business_unit:'other'},{source:'qa_test'},{stage:'closed'},{office_bucket:'job'},{needs_first_response:false},
    {deleted_at:new Date().toISOString()},{qa_archived_at:new Date().toISOString()},
    {created_at:new Date(Date.now()-15*86_400_000).toISOString()}, {created_at:new Date(Date.now()+60_000).toISOString()}];
  for(let i=0;i<invalid.length;i++) await io.add(61+i,invalid[i]);
  await io.add(90);
  await io.db.query("INSERT INTO post_intake_work(job_id,status,reason,facts_version) VALUES($1,'failed','ENQUIRY_BACKLOG_MANUAL','enquiry-backlog-manual')",[id(90)]);
  await io.add(100);io.route=async()=>sent();
  assert.deepEqual(await io.sweep(),{checked:1,sent:1});assert.deepEqual(io.routed,[id(100)]);
  assert.deepEqual((await io.db.query('SELECT job_id FROM first_response_retries')).rows,[{job_id:id(100)}]);
});

test('actual SQL respects exact activation/14-day boundaries and rejects future or nonfinite times', async t=>{
  const io=await fixture(t);const now=new Date('2026-10-20T12:00:00Z');const boundary=new Date(now.getTime()-14*86_400_000);
  await io.add(1,{created_at:boundary.toISOString()});await io.add(2,{created_at:new Date(boundary.getTime()-1).toISOString()});
  await io.add(3,{created_at:now.toISOString()});await io.add(4,{created_at:new Date(now.getTime()+1).toISOString()});
  const scope=async active=>(await io.db.query('SELECT job_id FROM first_response_retry_scope($1,$2) ORDER BY job_id',[active,now.toISOString()])).rows.map(x=>x.job_id);
  assert.deepEqual(await scope(new Date(boundary.getTime()-86_400_000).toISOString()),[id(1),id(3)]);
  assert.deepEqual(await scope(new Date(boundary.getTime()+1).toISOString()),[id(3)]);
  assert.deepEqual(await scope('infinity'),[]);
  for(const value of [null,'infinity','-infinity']) await assert.rejects(io.db.query('SELECT * FROM claim_first_response_retries($1,5)',[value]),/Invalid activation time/);
  for(const limit of [null,0,6,-1]) await assert.rejects(io.db.query('SELECT * FROM claim_first_response_retries($1,$2)',[io.active,limit]),/between 1 and 5/);
  assert.equal((await io.db.query('SELECT * FROM first_response_retries')).rows.length,0);
});

test('actual SQL: outstanding claims are disjoint and expired ownership cannot start or finish after takeover', async t=>{
  const io=await fixture(t);for(let n=1;n<=6;n++) await io.add(n);
  const first=await io.claim(),second=await io.claim();assert.equal(first.length,5);assert.equal(second.length,1);
  assert.equal(new Set([...first,...second].map(c=>c.job_id)).size,6);
  assert.equal((await io.claim()).length,0);
  const old=first[0];
  await io.db.query("UPDATE first_response_retries SET lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE job_id=$1",[old.job_id]);
  const [replacement]=await io.claim();assert.equal(replacement.job_id,old.job_id);assert.notEqual(replacement.claim_token,old.claim_token);
  await assert.rejects(io.start(old),/expired or was taken over/);
  await assert.rejects(io.finish(old),/expired or was taken over/);
  assert.equal(await io.start(replacement),true);assert.equal(await io.finish(replacement),true);
  const row=(await io.db.query('SELECT * FROM first_response_retries WHERE job_id=$1',[old.job_id])).rows[0];
  assert.equal(row.attempt_count,2);assert.equal(row.claim_token,null);assert.equal(row.last_outcome,'held');
});

test('actual SQL + actual worker: intake becoming active between claim and route is fenced out', async t=>{
  const io=await fixture(t);await io.add(1);
  io.afterClaim=async()=>{await io.db.query("INSERT INTO post_intake_work(job_id,status) VALUES($1,'processing')",[id(1)]);};
  assert.deepEqual(await io.sweep(),{checked:0,sent:0});assert.equal(io.routed.length,0);
  const row=(await io.db.query('SELECT * FROM first_response_retries')).rows[0];assert.equal(row.last_outcome,'held');
  assert.match(row.last_reason,/intake is still active/);
});

test('actual SQL: held events and retry completion are atomic in both failure directions', async t=>{
  const io=await fixture(t);await io.add(1);const [claim]=await io.claim();
  await io.db.exec(`CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'event write denied'; END; $$;
    CREATE TRIGGER reject_event BEFORE INSERT ON workflow_events FOR EACH ROW EXECUTE FUNCTION reject_event();`);
  await assert.rejects(io.finish(claim),/event write denied/);
  let row=(await io.db.query('SELECT * FROM first_response_retries')).rows[0];
  assert.equal(row.claim_token,claim.claim_token);assert.equal(row.last_outcome,null);
  assert.equal((await io.db.query('SELECT * FROM workflow_events')).rows.length,0);
  await io.db.exec(`DROP TRIGGER reject_event ON workflow_events;
    CREATE FUNCTION reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.claim_token IS NULL THEN RAISE EXCEPTION 'ledger write denied'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER reject_completion BEFORE UPDATE ON first_response_retries FOR EACH ROW EXECUTE FUNCTION reject_completion();`);
  await assert.rejects(io.finish(claim),/ledger write denied/);
  assert.equal((await io.db.query('SELECT * FROM workflow_events')).rows.length,0);
  row=(await io.db.query('SELECT * FROM first_response_retries')).rows[0];assert.equal(row.claim_token,claim.claim_token);assert.equal(row.last_outcome,null);
  await io.db.exec('DROP TRIGGER reject_completion ON first_response_retries');
  assert.equal(await io.finish(claim),true);assert.equal((await io.db.query('SELECT * FROM workflow_events')).rows.length,1);
});

test('actual SQL: exponential backoff is durable and capped; unchanged reasons do not flood the history', async t=>{
  const io=await fixture(t);await io.add(1);
  const delays=[120,240,480,960,1920,3600,3600];
  for(let i=0;i<delays.length;i++) {
    const [claim]=await io.claim();assert.ok(claim);
    await io.finish(claim,'held',i===6?'different held reason':'media still ambiguous');
    const row=(await io.db.query('SELECT attempt_count,EXTRACT(EPOCH FROM (next_attempt_at-last_recorded_at))::integer AS delay FROM first_response_retries')).rows[0];
    assert.equal(row.attempt_count,i+1);assert.equal(row.delay,delays[i]);assert.equal((await io.claim()).length,0);
    await io.db.exec("UPDATE first_response_retries SET next_attempt_at=now()-interval '1 second'");
  }
  assert.equal((await io.db.query('SELECT * FROM workflow_events')).rows.length,2);
});

test('actual SQL + actual worker: unreadable safety facts and failed audit writes are visible and stop routing', async t=>{
  const io=await fixture(t);await io.add(1);await io.add(2);
  await io.db.exec('ALTER TABLE post_intake_work RENAME TO hidden_intake_work');
  await assert.rejects(io.sweep(),/post_intake_work.*does not exist/);assert.equal(io.routed.length,0);
  await io.db.exec(`ALTER TABLE hidden_intake_work RENAME TO post_intake_work;
    CREATE FUNCTION reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'event write denied'; END; $$;
    CREATE TRIGGER reject_event BEFORE INSERT ON workflow_events FOR EACH ROW EXECUTE FUNCTION reject_event();`);
  await assert.rejects(io.sweep(),/event write denied/);assert.equal(io.routed.length,1);
  assert.equal((await io.db.query('SELECT * FROM workflow_events')).rows.length,0);
  assert.ok((await io.db.query('SELECT claim_token FROM first_response_retries')).rows.every(r=>r.claim_token));
});

test('actual SQL + actual worker: accepted delivery plus failed completion does not unconditionally resend', async t=>{
  const io=await fixture(t);await io.add(1);
  await io.db.exec(`CREATE FUNCTION reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.last_outcome='sent' THEN RAISE EXCEPTION 'ledger unavailable'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER reject_completion BEFORE UPDATE ON first_response_retries FOR EACH ROW EXECUTE FUNCTION reject_completion();`);
  io.route=async jobId=>{await io.db.query('UPDATE jobs SET needs_first_response=false WHERE id=$1',[jobId]);return sent();};
  await assert.rejects(io.sweep(),/ledger unavailable/);assert.equal(io.routed.length,1);
  await io.db.exec("DROP TRIGGER reject_completion ON first_response_retries; UPDATE first_response_retries SET lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second'");
  assert.deepEqual(await io.sweep(),{checked:0,sent:0});assert.equal(io.routed.length,1);
  // A provider-only/uncertain outcome with no canonical answer is still delegated to the existing guarded router,
  // whose delivery-history and unique-attempt suites must run at integration; this worker never calls a sender.
});

test('actual SQL: retry data/RPCs are service-only and rollback preserves jobs and audit history', async t=>{
  const io=await fixture(t);await io.add(1);
  for(const role of ['anon','authenticated']) {
    await io.db.exec('SET ROLE '+role);
    try {
      await assert.rejects(io.db.query('SELECT * FROM first_response_retries'),/permission denied/);
      await assert.rejects(io.db.query('SELECT * FROM claim_first_response_retries($1,5)',[io.active]),/permission denied/);
      await assert.rejects(io.db.query('SELECT * FROM first_response_retry_scope($1,now())',[io.active]),/permission denied/);
      await assert.rejects(io.db.query('SELECT start_first_response_retry($1,$2,$3)',[id(1),id(2),io.active]),/permission denied/);
      await assert.rejects(io.db.query("SELECT finish_first_response_retry($1,$2,'held','none','test')",[id(1),id(2)]),/permission denied/);
    } finally { await io.db.exec('RESET ROLE'); }
  }
  await io.db.exec('SET ROLE service_role');let claim;
  try { [claim]=await io.claim();assert.ok(claim);assert.equal(await io.start(claim),true);assert.equal(await io.finish(claim),true); }
  finally { await io.db.exec('RESET ROLE'); }
  assert.equal((await io.db.query('SELECT * FROM workflow_events')).rows.length,1);
  await io.db.exec(rollback);
  assert.equal((await io.db.query('SELECT * FROM jobs')).rows.length,1);assert.equal((await io.db.query('SELECT * FROM workflow_events')).rows.length,1);
  assert.equal((await io.db.query("SELECT to_regclass('public.first_response_retries') AS relation")).rows[0].relation,null);
});
