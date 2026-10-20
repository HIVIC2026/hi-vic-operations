import test from 'node:test';
import assert from 'node:assert/strict';
import {actualFixture} from './helpers/bulk-actual-source.mjs';
import {ids,extracted,file,stored} from './helpers/bulk-fencing-fixture.mjs';

async function pendingFileFixture(t){const f=await actualFixture(t);await f.setFiles();await f.rpc('edit_bulk_import_row',[ids.row,ids.boss,{import_stage:'quoted'},{import_stage:'visited'}]);return f;}
const confirm=f=>f.handlers.confirmBulkBatch({data:{batchId:ids.batch,skipRowIds:[]}});

test('actual confirm checks bytes read-only, keeps partial job, and resumes the same job after file recovery',async t=>{
 const f=await pendingFileFixture(t);f.fetchMode='unavailable';const first=await confirm(f);
 assert.equal(first.created,0);assert.equal(first.failed,1);assert.equal(first.remaining,1);assert.equal(first.remainingUnknown,false);
 const partial=await f.row();assert.equal(partial.status,'pending');assert.ok(partial.job_id);assert.match(partial.confirm_error,/kept.*try again/);assert.equal(f.removed.length,0);
 f.fetchMode='good';const second=await confirm(f);assert.equal(second.created,1);assert.equal(second.counts.added,1);assert.equal(second.remaining,0);
 assert.equal((await f.row()).job_id,partial.job_id);assert.equal((await f.one('SELECT count(*)::int n FROM documents WHERE job_id=$1 AND storage_path=$2',[partial.job_id,stored])).n,1);
 assert.ok(f.calls.includes('rpc:renew_bulk_import_row'));assert.equal(f.removed.length,0);
});

test('positively invalid bytes also remain untouched by bulk verification until an explicit file replacement',async t=>{
 const f=await pendingFileFixture(t);f.fetchMode='bad';const r=await confirm(f);assert.equal(r.failed,1);assert.equal(r.remaining,1);assert.equal(f.removed.length,0);
 const row=await f.row();assert.ok(row.job_id);assert.equal(row.status,'pending');
 assert.match(row.confirm_error,/file type isn't accepted/);
});

test('post-job lost response retries the exact durable job without repeating owners or assignments',async t=>{
 const f=await pendingFileFixture(t);f.failAfter.set('prepare_bulk_import_job','Injected lost response after job commit');
 const result=await confirm(f);assert.equal(result.failed,1);const partial=await f.row();assert.ok(partial.job_id);
 const saved=await f.one('SELECT owner_id,property_id FROM jobs WHERE id=$1',[partial.job_id]);
 const again=await confirm(f);assert.equal(again.created,1);assert.deepEqual(await f.one('SELECT owner_id,property_id FROM jobs WHERE id=$1',[partial.job_id]),saved);
 assert.equal((await f.one('SELECT count(*)::int n FROM job_assignments WHERE job_id=$1',[partial.job_id])).n,1);
});

test('final commit with lost response remains confirmed and reports persisted counts without rerunning a completed job',async t=>{
 const f=await pendingFileFixture(t);f.failAfter.set('finish_bulk_import_row','Injected lost response after complete commit');
 const result=await confirm(f);assert.equal(result.failed,1);assert.equal(result.counts.added,1);assert.equal(result.remaining,0);assert.equal((await f.row()).status,'confirmed');
 assert.match(result.incomplete[0].reason,/claim or failure record could not be updated/);
 const notice=f.load('bulk-import.core').bulkCompletionMessage(result);assert.match(notice,/1 added/);assert.doesNotMatch(notice,/0 jobs added|not finished/);assert.match(notice,/Check the completion messages/);
 const before=await f.snapshot();await assert.rejects(confirm(f),/finished|not ready/);assert.deepEqual(await f.snapshot(),before);
});

test('a database count error is visible and unknown; a failed failure-record write is also reported',async t=>{
 const f=await pendingFileFixture(t);f.fetchMode='network';f.fail.set('rpc:release_bulk_import_row','Injected failure-record outage');f.fail.set('rpc:close_bulk_import_batch','Injected count outage');
 const r=await confirm(f);assert.equal(r.remaining,null);assert.equal(r.remainingUnknown,true);assert.match(r.closeError,/count outage/);assert.match(r.incomplete[0].reason,/failure-record outage/);
 assert.match(f.load('bulk-import.core').bulkCompletionMessage(r),/could not be verified/);
 assert.equal((await f.one('SELECT status FROM bulk_import_batches WHERE id=$1',[ids.batch])).status,'analysed');
});

test('source/Auth and complete-row read errors fail closed before any new job is created',async t=>{
 const f=await pendingFileFixture(t);f.fail.set('auth:getUserById','Injected Auth read failure');const result=await confirm(f);assert.equal(result.failed,1);assert.equal((await f.row()).job_id,null);
 f.fail.clear();f.rowCap=0;await assert.rejects(confirm(f),/complete upload history|Expected exactly/);assert.equal((await f.row()).job_id,null);
});

test('actual creation strips forged preExtracted owner permission; explicit review stamps the authenticated actor',async t=>{
 const f=await actualFixture(t);const spoof={...extracted,email:'new-extractor@hivic-test.example',address_line:'900 Fresh Street',owner_consent:{confirmed_by:ids.office,confirmed_at:'2020-01-01T00:00:00Z',wording:'Fabricated client permission'}};
 const r=await f.handlers.createBulkBatch({data:{businessId:ids.business,onBehalf:false,listFilename:'fixture.csv',rawRows:[],documents:[],manifest:[],fileReads:[],preExtracted:[spoof]}});
 const rows=await f.query('SELECT * FROM bulk_import_rows WHERE batch_id=$1',[r.batchId]);assert.equal(rows.length,1);assert.equal(rows[0].extracted.owner_consent,undefined);
 assert.equal((await f.one('SELECT summary FROM bulk_import_batches WHERE id=$1',[r.batchId])).summary.permission,null);
 const held=await f.handlers.confirmBulkBatch({data:{batchId:r.batchId,skipRowIds:[]}});assert.equal(held.failed,1);assert.equal(held.created,0);assert.match(held.incomplete[0].reason,/permission/);
 await f.handlers.setBulkReviewPlan({data:{batchId:r.batchId,batchPlan:{mode:'hivic'},rows:[{rowId:rows[0].id,stage:'visited',plan:null,siteCheck:'yes',quoted:'no',quotedPrice:null,consent:true}]}});
 const final=await f.one('SELECT extracted FROM bulk_import_rows WHERE id=$1',[rows[0].id]);assert.equal(final.extracted.owner_consent.confirmed_by,ids.boss);assert.notEqual(final.extracted.owner_consent.confirmed_at,spoof.owner_consent.confirmed_at);assert.notEqual(final.extracted.owner_consent.wording,spoof.owner_consent.wording);
});
