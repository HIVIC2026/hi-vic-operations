// Review #3 (30 Oct): the REAL Test Centre handlers, called as the TEST office login (qa_office, not admin).
// officeJob stands in for requireOfficeJob (identity + isolation); the real one is covered by qa-office-job-scope-practice-db.
import assert from 'node:assert/strict';
import test from 'node:test';
import { fixture, id } from './helpers/qa-fixture.mjs';

const asTestOffice = (io, isolated = new Set([id(1)])) => {
  io.isAdmin = false; io.isQaOffice = true;
  io.context.officeJob = async jobId => { if (io.isAdmin) throw new Error('Admin only.'); if (!isolated.has(jobId)) throw new Error('Only fully isolated TEST jobs are available to TEST office.'); return 'qa_office'; };
};

test('TEST office can archive an isolated TEST journey', async t => {
  const io = await fixture(t); asTestOffice(io);
  await io.db.exec("ALTER TABLE jobs ADD COLUMN stage text, ADD COLUMN cancelled_reason text, ADD COLUMN next_action text");
  assert.deepEqual(await io.handlers.archiveQaJourney({ data: { jobId: id(1) } }), { ok: true });
  assert.ok((await io.snapshot()).jobs[0].qa_archived_at);
});

test('TEST office is refused a TEST journey that is not fully isolated, and nothing changes', async t => {
  const io = await fixture(t); asTestOffice(io, new Set());
  const before = await io.snapshot();
  for (const call of [
    () => io.handlers.archiveQaJourney({ data: { jobId: id(1) } }),
    () => io.handlers.issueQaPersonaLink({ data: { jobId: id(1), persona: 'owner' } }),
    () => io.handlers.issueQaWorkerLink({ data: { jobId: id(1) } }),
    () => io.handlers.prepareQaJourneyAccess({ data: { jobId: id(1) } }),
    () => io.handlers.simulateQaJourneyTime({ data: { jobId: id(1), simulation: 'response_24h' } }),
    () => io.handlers.simulateQaPayment({ data: { jobId: id(1), kind: 'piesa' } }),
  ]) await assert.rejects(call(), /fully isolated TEST jobs/);
  assert.deepEqual(await io.snapshot(), before);
  assert.equal(io.issued.length, 0);
});

test('TEST office still cannot create TEST trade accounts', async t => {
  const io = await fixture(t); asTestOffice(io);
  const before = await io.snapshot();
  await assert.rejects(io.handlers.createTestTradeAccounts({ data: {} }), /Admin only/);
  assert.deepEqual(await io.snapshot(), before);
});

test('a login with both admin and TEST office roles is refused', async t => {
  const io = await fixture(t); asTestOffice(io); io.isAdmin = true;
  await assert.rejects(io.handlers.archiveQaJourney({ data: { jobId: id(1) } }), /Admin only/);
});