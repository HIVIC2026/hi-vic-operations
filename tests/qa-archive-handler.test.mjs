import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, id } from './helpers/qa-fixture.mjs';

test('actual archive action preserves TEST accounts/history, revokes links and ends assignments on PGlite', async t => {
  const io = await fixture(t);
  await io.db.exec("ALTER TABLE jobs ADD COLUMN stage text, ADD COLUMN cancelled_reason text, ADD COLUMN next_action text; CREATE TABLE preserved_financial_history (id integer PRIMARY KEY, job_id uuid, amount numeric); INSERT INTO preserved_financial_history VALUES (1,'00000000-0000-4000-8000-000000000001',123.45)");
  const before = await io.snapshot();
  assert.deepEqual(await io.handlers.archiveQaJourney({ data: { jobId: id(1) } }), { ok: true });
  const after = await io.snapshot();
  assert.equal(after.jobs.length, before.jobs.length);
  assert.equal(after.jobs[0].source, 'qa_test');
  assert.ok(after.jobs[0].qa_archived_at);
  assert.equal(after.jobs[0].stage, 'cancelled');
  assert.ok(after.worker_job_links.every(row => row.revoked_at && row.revoked_by));
  assert.ok(after.job_assignments.every(row => !row.active && row.ended_at && row.end_reason === 'TEST journey archived'));
  for (const table of ['auth', 'owners', 'profiles', 'user_roles', 'businesses', 'business_members', 'partner_workers', 'rate_cards', 'rate_card_items']) assert.deepEqual(after[table], before[table]);
  assert.equal((await io.db.query('SELECT amount FROM preserved_financial_history')).rows[0].amount, '123.45');
  assert.equal(io.issued.length, 0);
  await assert.rejects(io.handlers.archiveQaJourney({ data: { jobId: id(1) } }), /active TEST journey/);
});

test('archive stops after link-write failure without ending assignments or archiving job', async t => {
  const io = await fixture(t);
  const before = await io.snapshot();
  io.fail.set('worker_job_links:update', 'injected revocation failure');
  await assert.rejects(io.handlers.archiveQaJourney({ data: { jobId: id(1) } }), /Could not revoke TEST access/);
  assert.deepEqual(await io.snapshot(), before);
});