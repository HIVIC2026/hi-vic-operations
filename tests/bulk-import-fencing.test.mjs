import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ids,id,extracted,jobInput,quotePlan,ownerLink,file,stored,source} from './helpers/bulk-fencing-fixture.mjs';

const rawPrivileges=['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
const rawTables=['bulk_import_batches','bulk_import_rows'];
async function expectRawPrivileges(f,role,allowed){
 for(const table of rawTables){
  const rows=await f.query('SELECT privilege,has_table_privilege($1,$2,privilege) AS allowed FROM unnest($3::text[]) p(privilege) ORDER BY privilege',[role,table,rawPrivileges]);
  assert.deepEqual(rows.filter(r=>r.allowed).map(r=>r.privilege),[...allowed].sort(),`${role} on ${table}`);
 }
}
async function expectNoPublicRawGrants(f){
 assert.deepEqual(await f.query("SELECT c.relname,a.privilege_type FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=ANY($1::regclass[]) AND a.grantee=0",[rawTables]),[]);
}
const broaderRawGrants='GRANT ALL ON public.bulk_import_batches,public.bulk_import_rows TO PUBLIC,anon,authenticated';

test('actual migration applies; raw browser reads/writes and direct guarded RPCs cannot bypass boss/Office access',async t=>{
 const f=await fixture(t,{migrate:false});
 // Live authenticated grants are broader than 0104. Also prove inherited PUBLIC/anon grants are removed.
 await f.db.exec(broaderRawGrants);
 for(const role of ['anon','authenticated','service_role'])await expectRawPrivileges(f,role,rawPrivileges);
 await f.db.exec(source('docs/pending-migrations/0213_bulk_import_fencing.sql'));
 for(const role of ['anon','authenticated']){
  await expectRawPrivileges(f,role,[]);
  const granted=await f.query("SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND (proname LIKE '%bulk_import%' OR proname='save_bulk_import_analysis') AND prorettype <> 'trigger'::regtype AND has_function_privilege($1,oid,'EXECUTE')",[role]);
  assert.deepEqual(granted,[]);
 }
 await expectNoPublicRawGrants(f);
 await expectRawPrivileges(f,'service_role',rawPrivileges);
 await f.db.exec('SET ROLE authenticated');
 await assert.rejects(f.query('SELECT extracted FROM bulk_import_rows WHERE id=$1',[ids.row]),/permission denied/);
 await assert.rejects(f.query('SELECT summary FROM bulk_import_batches WHERE id=$1',[ids.batch]),/permission denied/);
 await assert.rejects(f.query('UPDATE bulk_import_rows SET job_id=$2,status=$3 WHERE id=$1',[ids.row,id(90),'confirmed']),/permission denied/);
 await assert.rejects(f.claim(),/permission denied/);
 await f.db.exec('RESET ROLE');
 await assert.rejects(f.query("UPDATE bulk_import_rows SET confirm_claim_token=$2 WHERE id=$1",[ids.row,ids.token]),/guarded upload action/);
 await f.db.exec('SET ROLE service_role');
 assert.equal((await f.query('SELECT id FROM bulk_import_rows WHERE id=$1',[ids.row])).length,1);
 assert.equal((await f.rpc('bulk_import_batch_counts',[[ids.batch],ids.boss]))[ids.batch].found,1);
 await f.db.exec('RESET ROLE');
});

test('stale A cannot prepare, renew, finish, release or clear successor B after takeover',async t=>{
 const f=await fixture(t);await f.claim();const first=await f.prepare();
 await f.expire();await f.claim(ids.boss,ids.successor);const before=await f.snapshot();
 await assert.rejects(f.prepare(),/claim is no longer current/);
 await assert.rejects(f.rpc('renew_bulk_import_row',[ids.row,ids.boss,ids.token]),/claim is no longer current/);
 await assert.rejects(f.finish(),/claim is no longer current/);
 await assert.rejects(f.rpc('release_bulk_import_row',[ids.row,ids.boss,ids.token,'old error',false]),/claim is no longer current/);
 assert.deepEqual(await f.snapshot(),before);
 const resumed=await f.prepare(ids.boss,ids.successor);assert.equal(resumed.resumed,true);assert.equal(resumed.job.id,first.job.id);
 await f.finish(ids.boss,ids.successor);assert.equal((await f.row()).status,'confirmed');
 assert.equal((await f.one('SELECT count(*)::int n FROM jobs WHERE external_enquiry_id=$1',['bulk:'+ids.row])).n,1);
 assert.equal((await f.one('SELECT count(*)::int n FROM job_assignments WHERE job_id=$1',[first.job.id])).n,1);
});

test('active claims block competing clicks, skip, review edits and batch-plan replacement',async t=>{
 const f=await fixture(t);await f.claim();assert.equal(await f.claim(ids.office,ids.successor),null);
 await assert.rejects(f.rpc('edit_bulk_import_row',[ids.row,ids.boss,{status:'pending'},{duplicate_note:'changed'}]),/in progress/);
 await assert.rejects(f.rpc('set_bulk_import_plan',[ids.batch,ids.boss,{mode:'mine'}]),/in progress/);
 await f.prepare();await assert.rejects(f.rpc('release_bulk_import_row',[ids.row,ids.boss,ids.token,null,true]),/started job/);
});

test('current approval and active boss are rechecked, including Office on behalf',async t=>{
 const f=await fixture(t);await assert.rejects(f.claim(ids.member),/active business admin/);
 await f.claim();await f.query("UPDATE businesses SET onboarding_status='suspended' WHERE id=$1",[ids.business]);
 const before=await f.snapshot();await assert.rejects(f.prepare(),/not currently approved/);await assert.rejects(f.prepare(ids.office),/not currently approved/);assert.deepEqual(await f.snapshot(),before);
 await f.query("UPDATE businesses SET onboarding_status='approved' WHERE id=$1",[ids.business]);
 await f.query('UPDATE business_members SET active=false WHERE user_id=$1',[ids.boss]);
 await assert.rejects(f.prepare(),/active business admin/);await assert.rejects(f.prepare(ids.office),/no active business admin/);
});

test('expired credentials hold; Office assignment uses the active installer boss',async t=>{
 const f=await fixture(t);await f.claim(ids.office);
 await f.query("INSERT INTO business_credentials(business_id,kind,label,critical,expires_at) VALUES($1,'installer_certification','Expired certificate',true,'2020-01-01')",[ids.business]);
 await assert.rejects(f.prepare(ids.office),/credential has expired/);
 await f.query("UPDATE business_credentials SET expires_at='2099-01-01' WHERE business_id=$1",[ids.business]);
 const {job}=await f.prepare(ids.office);const a=await f.one('SELECT * FROM job_assignments WHERE job_id=$1',[job.id]);assert.equal(a.user_id,ids.boss);assert.equal(a.assigned_by,ids.office);
});

test('Office finalization rechecks the assigned active boss after job preparation',async t=>{
 const f=await fixture(t);await f.claim(ids.office);await f.prepare(ids.office);
 await f.query('UPDATE business_members SET active=false WHERE user_id=$1',[ids.boss]);const before=await f.snapshot();
 await assert.rejects(f.finish(ids.office),/no active business admin/);assert.deepEqual(await f.snapshot(),before);
});

test('failed job/assignment transaction leaves no orphan owner, property, job or snapshot',async t=>{
 const f=await fixture(t);await f.claim();const before=await f.snapshot();
 await f.db.exec("CREATE FUNCTION reject_bulk_assignment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected assignment failure'; END $$; CREATE TRIGGER reject_bulk_assignment BEFORE INSERT ON job_assignments FOR EACH ROW EXECUTE FUNCTION reject_bulk_assignment()");
 await assert.rejects(f.prepare(),/injected assignment failure/);assert.deepEqual(await f.snapshot(),before);
 await f.db.exec('DROP TRIGGER reject_bulk_assignment ON job_assignments');await f.prepare();
});

test('partial-job intake is frozen; retry preserves supplied figures and same job',async t=>{
 const f=await fixture(t);await f.claim();const {job}=await f.prepare();
 await f.rpc('release_bulk_import_row',[ids.row,ids.boss,ids.token,'file unavailable',false]);
 await assert.rejects(f.rpc('edit_bulk_import_row',[ids.row,ids.boss,{extracted},{extracted:{...extracted,price_inc_gst:9999}}]),/intake details are frozen/);
 await f.rpc('edit_bulk_import_row',[ids.row,ids.boss,{matched_files:[]},{matched_files:[]}]);
 await f.claim(ids.boss,ids.successor);await f.prepare(ids.boss,ids.successor,{...jobInput,installer_quoted_price_inc_gst:9999});
 const saved=await f.one('SELECT installer_quoted_price_inc_gst,installer_site_check FROM jobs WHERE id=$1',[job.id]);assert.equal(Number(saved.installer_quoted_price_inc_gst),1000);assert.equal(saved.installer_site_check,'yes');
 const m=await f.one('SELECT provenance,supplied_area_m2,status FROM ceiling_measurements WHERE job_id=$1',[job.id]);assert.equal(m.provenance,'installer_supplied_provisional');assert.equal(Number(m.supplied_area_m2),50);assert.equal(m.status,'needs_review');
});

test('required-file failure leaves the row pending and later retry attaches exactly once',async t=>{
 const f=await fixture(t);await f.setFiles();await f.claim();const {job}=await f.prepare();const before=await f.snapshot();
 await assert.rejects(f.finish(),/complete file verification/);assert.deepEqual(await f.snapshot(),before);
 await assert.rejects(f.finish(ids.boss,ids.token,quotePlan(),[{...file,storedPath:'partners/'+ids.other+'/imports/wrong.jpg'}]),/no verified stored copy/);assert.deepEqual(await f.snapshot(),before);
 const done=await f.finish(ids.boss,ids.token,quotePlan(),[file]);assert.deepEqual(done.attached,[file.originalPath]);
 assert.equal((await f.one('SELECT count(*)::int n FROM documents WHERE job_id=$1 AND storage_path=$2',[job.id,stored])).n,1);
});

test('document-key conflict succeeds only for the exact same job, kind and stored path',async t=>{
 const f=await fixture(t);await f.setFiles();await f.claim();const {job}=await f.prepare();
 await f.query("INSERT INTO documents(job_id,kind,title,storage_path,source_system,external_id) VALUES($1,'financial','Different record','wrong-path','bulk_import',$2)",[job.id,stored]);
 const before=await f.snapshot();await assert.rejects(f.finish(ids.boss,ids.token,quotePlan(),[file]),/different document owns/);assert.deepEqual(await f.snapshot(),before);
 await f.query("DELETE FROM documents WHERE job_id=$1 AND source_system='bulk_import'",[job.id]);
 await f.query("INSERT INTO documents(job_id,kind,title,storage_path,source_system,external_id) VALUES($1,'installer_import','Earlier attachment',$2,'bulk_import',$2)",[job.id,stored]);
 await f.finish(ids.boss,ids.token,quotePlan(),[file]);assert.equal((await f.one('SELECT count(*)::int n FROM documents WHERE job_id=$1',[job.id])).n,1);
});

test('quote and every attachment/link/event finish atomically; failed quote items roll all final writes back',async t=>{
 const f=await fixture(t);await f.setFiles();await f.claim();await f.prepare();const before=await f.snapshot();
 await f.db.exec("CREATE FUNCTION reject_bulk_quote_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.code='AP_FEE' THEN RAISE EXCEPTION 'injected line failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_bulk_quote_item BEFORE INSERT ON quote_items FOR EACH ROW EXECUTE FUNCTION reject_bulk_quote_item()");
 await assert.rejects(f.finish(ids.boss,ids.token,quotePlan(),[file]),/injected line failure/);assert.deepEqual(await f.snapshot(),before);
 await f.db.exec('DROP TRIGGER reject_bulk_quote_item ON quote_items');await f.finish(ids.boss,ids.token,quotePlan(),[file]);
 const row=await f.row();assert.equal((await f.one('SELECT count(*)::int n FROM quote_items WHERE quote_id IN (SELECT id FROM quotes WHERE job_id=$1)',[row.job_id])).n,3);
});

test('existing incomplete quote is held intact; complete saved quote is reused without repricing',async t=>{
 const f=await fixture(t);await f.claim();const {job}=await f.prepare();const p=quotePlan();
 const q=await f.one("INSERT INTO quotes(job_id,kind,option_label,option_code,status,subtotal_inc_gst,gst_amount,veec_discount_inc_gst,customer_total_inc_gst,partner_business_id) VALUES($1,'installation','Existing','INSTALLER_A1','draft',1549,140.82,500,1049,$2) RETURNING id",[job.id,ids.business]);
 const before=await f.snapshot();await assert.rejects(f.finish(ids.boss,ids.token,null),/earlier quote is incomplete/);assert.deepEqual(await f.snapshot(),before);
 for(const l of p.lines) await f.query('INSERT INTO quote_items(quote_id,code,description,quantity,unit,unit_price_inc_gst,line_total_inc_gst) VALUES($1,$2,$3,$4,$5,$6,$7)',[q.id,l.code,l.description,l.quantity,l.unit,l.unit_price_inc_gst,l.line_total_inc_gst]);
 const quoteBefore=await f.query('SELECT * FROM quotes WHERE id=$1',[q.id]);await f.finish(ids.boss,ids.token,quotePlan({subtotal_inc_gst:99999}));assert.deepEqual(await f.query('SELECT * FROM quotes WHERE id=$1',[q.id]),quoteBefore);
});

test('missing permission event recovers independently; event-write error prevents false confirmation',async t=>{
 const f=await fixture(t);await f.claim();const {job}=await f.prepare();
 await f.query("INSERT INTO workflow_events(job_id,actor_id,event_type,summary) VALUES($1,$2,'bulk_import_confirmed','Earlier job creation')",[job.id,ids.boss]);
 await f.db.exec("CREATE FUNCTION reject_bulk_permission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='bulk_import_contact_permission' THEN RAISE EXCEPTION 'injected consent event failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_bulk_permission BEFORE INSERT ON workflow_events FOR EACH ROW EXECUTE FUNCTION reject_bulk_permission()");
 const before=await f.snapshot();await assert.rejects(f.finish(),/injected consent event failure/);assert.deepEqual(await f.snapshot(),before);
 await f.db.exec('DROP TRIGGER reject_bulk_permission ON workflow_events');await f.finish();
 const events=await f.query("SELECT event_type,count(*)::int n FROM workflow_events WHERE job_id=$1 AND event_type IN ('bulk_import_confirmed','bulk_import_contact_permission') GROUP BY event_type",[job.id]);assert.equal(events.length,2);assert.ok(events.every(e=>e.n===1));
});

test('historical attachment repair appends separate immutable audit and preserves batch, row, consent and quote',async t=>{
 const f=await fixture(t);await f.setFiles();await f.claim();const {job}=await f.prepare();await f.finish(ids.boss,ids.token,quotePlan(),[file]);await f.rpc('close_bulk_import_batch',[ids.batch,ids.boss]);
 // Reproduce an old confirmed import whose original manifest exists but document attachment was missing.
 await f.query('DELETE FROM documents WHERE job_id=$1',[job.id]);const before=await f.snapshot();
 await assert.rejects(f.rpc('repair_bulk_import_attachment',[ids.row,ids.boss,file]),/Only Office/);
 const rid=await f.rpc('repair_bulk_import_attachment',[ids.row,ids.office,file]);assert.equal(await f.rpc('repair_bulk_import_attachment',[ids.row,ids.office,file]),rid);
 const after=await f.snapshot();for(const table of ['bulk_import_batches','bulk_import_rows','quotes','quote_items','owner_eligibility_links','jobs'])assert.deepEqual(after[table],before[table],table);
 const priorEvents=after.workflow_events.filter(e=>e.event_type!=='bulk_import_attachment_repaired');assert.deepEqual(priorEvents,before.workflow_events);
 assert.equal(after.bulk_import_attachment_repairs.length,1);assert.equal(after.documents.filter(d=>d.job_id===job.id).length,1);
 await assert.rejects(f.query('DELETE FROM bulk_import_attachment_repairs WHERE id=$1',[rid]),/permanent and immutable/);
 await assert.rejects(f.rpc('edit_bulk_import_row',[ids.row,ids.office,{status:'confirmed'},{matched_files:[]}]),/permanent history/);
 await assert.rejects(f.query('DELETE FROM bulk_import_rows WHERE id=$1',[ids.row]),/guarded upload action|permanent history/);
});

test('history counts use persisted status and job IDs: six found, five added, one skipped',async t=>{
 const f=await fixture(t);await f.claim();const {job}=await f.prepare();await f.finish();
 for(let i=0;i<4;i++){
  const j=await f.one("INSERT INTO jobs(owner_id,property_id,business_unit,external_enquiry_id) SELECT owner_id,property_id,'hivic',$2 FROM jobs WHERE id=$1 RETURNING id",[job.id,'history-'+i]);
  await f.query("INSERT INTO bulk_import_rows(id,batch_id,row_index,status,job_id) VALUES($1,$2,$3,'confirmed',$4)",[id(30+i),ids.batch,i+1,j.id]);
 }
 await f.query("INSERT INTO bulk_import_rows(id,batch_id,row_index,status) VALUES($1,$2,5,'skipped')",[id(40),ids.batch]);
 const counts=await f.rpc('close_bulk_import_batch',[ids.batch,ids.boss]);assert.deepEqual(counts,{found:6,added:5,skipped:1,pending:0,needsRepair:0});
 assert.deepEqual((await f.rpc('bulk_import_batch_counts',[[ids.batch],ids.boss]))[ids.batch],counts);
 await assert.rejects(f.claim(),/no longer be confirmed/);await assert.rejects(f.rpc('set_bulk_import_plan',[ids.batch,ids.office,{mode:'mine'}]),/permanent history/);
});

test('draft analysis replaces partial draft rows atomically and never reopens confirmed history',async t=>{
 const f=await fixture(t);await f.query("UPDATE bulk_import_batches SET status='draft' WHERE id=$1",[ids.batch]);
 const row={row_index:0,extracted,matched_files:[],match_confidence:'none',sort_result:'needs_visit',sort_reasons:[],missing_evidence:[],duplicate_note:null,import_stage:'not_visited'};
 const before=await f.snapshot();await assert.rejects(f.rpc('save_bulk_import_analysis',[ids.batch,ids.boss,[{...row,import_stage:'invalid'}],{rows:1}]),/import_stage_check/);assert.deepEqual(await f.snapshot(),before);
 await f.rpc('save_bulk_import_analysis',[ids.batch,ids.boss,[row],{rows:1}]);
 const rows=await f.query('SELECT * FROM bulk_import_rows WHERE batch_id=$1',[ids.batch]);assert.equal(rows.length,1);assert.notEqual(rows[0].id,ids.row);assert.equal(rows[0].extracted.owner_consent,undefined,'Extractor-supplied permission is never accepted as an authenticated declaration');
 await assert.rejects(f.rpc('save_bulk_import_analysis',[ids.batch,ids.boss,[row],{rows:1}]),/already analysed/);
});

test('empty-work migration rolls back and reapplies without changing existing jobs',async t=>{
 const f=await fixture(t,{seed:false,migrate:false});const jobs=await f.query('SELECT * FROM jobs ORDER BY id');
 await f.db.exec(broaderRawGrants);
 await f.db.exec(source('docs/pending-migrations/0213_bulk_import_fencing.sql'));
 await f.db.exec(source('docs/pending-migrations/0213_bulk_import_fencing.rollback.sql'));
 assert.deepEqual(await f.query('SELECT * FROM jobs ORDER BY id'),jobs);
 await expectRawPrivileges(f,'authenticated',['SELECT','INSERT','UPDATE']);
 await expectRawPrivileges(f,'anon',[]);
 await expectNoPublicRawGrants(f);
 await expectRawPrivileges(f,'service_role',rawPrivileges);
 assert.equal((await f.one("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='bulk_import_rows' AND column_name='confirm_claim_token'")).n,0);
 await f.db.exec(source('docs/pending-migrations/0213_bulk_import_fencing.sql'));
 await expectRawPrivileges(f,'authenticated',[]);
 await expectRawPrivileges(f,'anon',[]);
 await expectNoPublicRawGrants(f);
 await expectRawPrivileges(f,'service_role',rawPrivileges);
});

test('rollback refuses to discard durable importer snapshots or repair history',async t=>{
 const f=await fixture(t);await f.claim();await f.prepare();const before=await f.snapshot();
 await assert.rejects(f.db.exec(source('docs/pending-migrations/0213_bulk_import_fencing.rollback.sql')),/history exists/);await f.db.exec('ROLLBACK');
 assert.deepEqual(await f.snapshot(),before);
});
