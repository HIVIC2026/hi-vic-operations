// Isolated I/O verification of the fixed-ref production recovery and update functions.
// No network, live database, mail, storage or authentication service is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const sourceRoot = process.env.HIVIC_RECEIPT_SOURCE_ROOT || repoRoot;
const baseRoot = process.env.HIVIC_RECEIPT_BASE_SOURCE_ROOT || sourceRoot;
const testRequire = process.env.HIVIC_RECEIPT_TEST_DEPS_ROOT
  ? createRequire(resolve(process.env.HIVIC_RECEIPT_TEST_DEPS_ROOT, 'package.json'))
  : createRequire(import.meta.url);
const ts = testRequire('typescript');

function load(path, imports = {}) {
  // Local review may overlay changed files on a fixed source snapshot; repository runs use their own files.
  const override = resolve(sourceRoot, path);
  const source = readFileSync(existsSync(override) ? override : resolve(baseRoot, path), 'utf8');
  const compiled = ts.transpileModule(source, { fileName: path, reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  const errors = (compiled.diagnostics || []).filter(e => e.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join('\n'));
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(name => {
    if (!(name in imports)) throw new Error('Unexpected actual-source dependency: ' + name);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

function fixture({ feeAt = '2026-10-20T08:00:00Z', changeAt = '2026-10-20T05:00:00Z', quoted = 'have_quote', legacyQuoted = null, payer = 'hivic', feePayer = 'hivic', feeActor = null, noOptionalHistory = false, profilePresent = true, nullCount = () => false, fail = () => false, hide = () => false, siteCheck = null } = {}) {
  const events = [
    ['installer_evidence_acknowledged', '2026-10-20T01:00:00Z', {}],
    ['installer_coordination_chosen', '2026-10-20T01:00:00Z', { coordination: 'hivic_managed' }],
    ['installer_existing_insulation_declared', '2026-10-20T01:00:00Z', { value: 'below_r2' }],
    ['installer_intake_corrected', '2026-10-20T07:00:00Z', { insulation: 'none' }],
    ['installer_owner_fee_awareness', feeAt, { payer: feePayer }],
    ['installer_electrician_payer_changed', changeAt, { to: payer }],
    ...(quoted ? [['installer_quote_answer', '2026-10-20T06:00:00Z', { answer: quoted }]] : []),
  ].map(([event_type, created_at, details], i) => ({ id: 'event-' + i, job_id: 'job', event_type, created_at, details, actor_id: event_type === 'installer_owner_fee_awareness' ? feeActor : null }));
  const tables = {
    job_imports: [{ id: 'import', business_id: 'business', created_by: 'user', status: 'confirmed', files: [], job_id: 'job' }],
    jobs: [{ id: 'job', channel: 'installer_sourced', originating_installer_business_id: 'business', job_number: 'HV-TEST', installer_quoted: legacyQuoted, installer_site_check: siteCheck, installer_quoted_price_inc_gst: null, installer_price_includes: null, electrician_choice: payer === 'own' ? 'preferred' : payer === 'hivic' ? 'hivic_organise' : null }],
    workflow_events: noOptionalHistory ? [] : events, profiles: profilePresent && feeActor ? [{ id: feeActor, full_name: 'Fixture installer', email: 'fixture@example.invalid' }] : [], ceiling_measurements: [], owner_contact_consents: [], evidence_requirements: [], job_assignments: [],
  };
  const reads = [], writes = [], membershipChecks = [];
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.opts = {}; }
    select(columns, opts = {}) { this.columns = columns; this.opts = opts; return this; }
    eq(k, v) { this.filters.push([k, 'eq', v]); return this; }
    in(k, v) { this.filters.push([k, 'in', v]); return this; }
    is(k, v) { this.filters.push([k, 'eq', v]); return this; }
    order(k, { ascending = true } = {}) { this.sort = [k, ascending]; return this; }
    limit(n) { this.cap = n; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    insert(value) { writes.push({ table: this.table, op: 'insert', value }); throw new Error('Unexpected write'); }
    update(value) { writes.push({ table: this.table, op: 'update', value }); throw new Error('Unexpected write'); }
    delete() { writes.push({ table: this.table, op: 'delete' }); throw new Error('Unexpected write'); }
    then(ok, bad) { return Promise.resolve().then(() => {
      const q = { table: this.table, columns: this.columns, filters: this.filters };
      reads.push(q);
      if (fail(q)) return { data: null, count: null, error: { message: 'Injected history read failure' } };
      assert.ok(this.table in tables, 'Unexpected table: ' + this.table);
      let rows = tables[this.table].filter(r => this.filters.every(([k, op, v]) => op === 'in' ? v.includes(r[k]) : r[k] === v));
      if (hide(q)) rows = [];
      const count = rows.length;
      if (this.sort) { const [k, asc] = this.sort; rows = [...rows].sort((a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0) * (asc ? 1 : -1)); }
      if (this.cap !== undefined) rows = rows.slice(0, this.cap);
      return { data: this.opts.head ? null : this.one ? rows[0] ?? null : rows, count: this.opts.count === 'exact' && !nullCount(q) ? count : null, error: null };
    }).then(ok, bad); }
  }
  const admin = { from: table => new Query(table) };
  const workflow = { WorkflowError: class WorkflowError extends Error {}, logEvent: async (...args) => { writes.push({ op: 'logEvent', args }); throw new Error('Unexpected event write'); } };
  const details = load('src/lib/intake-quote-details.core.ts');
  const core = load('src/lib/installer-intake.core.ts', { './intake-quote-details.core': details });
  const imports = { './intake-quote-details.core': details, './installer-intake.core': core, '@/integrations/supabase/client.server': { supabaseAdmin: admin }, './workflow.server': workflow };
  const intake = load('src/lib/installer-intake.server.ts', imports);
  const recovery = load('src/lib/partner-import.server.ts', { ...imports, './installer-intake.server': intake, './pilot.core': {}, './pilot.server': { requireMember: async (...args) => membershipChecks.push(args) } });
  return { intake, recovery, reads, writes, membershipChecks };
}

const recover = f => f.recovery.getImportDraftFor('user', 'import', 'business');
const failsEvent = event => q => q.table === 'workflow_events' && q.filters.some(([k, op, value]) => k === 'event_type' && op === 'eq' && value === event);

test('actual recovery uses current fee declaration and newest insulation correction', async () => {
  const f = fixture(); const result = await recover(f);
  assert.equal(result.status, 'confirmed'); assert.equal(result.receipt.quoted, true);
  assert.equal(result.receipt.insulation, 'none'); assert.equal(result.receipt.feeHeld, false);
  assert.deepEqual(f.membershipChecks, [['user', 'business']]); assert.equal(f.writes.length, 0);
});
test('actual recovery keeps a fee hold after a later arrangement change even when payer matches again', async () => {
  const f = fixture({ feeAt: '2026-10-20T04:00:00Z' });
  assert.equal((await recover(f)).receipt.feeHeld, true); assert.equal(f.writes.length, 0);
});
test('actual recovery keeps missing quote answer null and preserves the hold', async () => {
  const f = fixture({ quoted: null, feeAt: '2026-10-20T04:00:00Z' });
  const result = await recover(f); assert.equal(result.receipt.quoted, null); assert.equal(result.receipt.feeHeld, true);
});
test('actual recovery uses explicit not-quoted answer over stale positive legacy answer', async () => {
  const f = fixture({ quoted: 'not_quoted', legacyQuoted: 'yes', feeAt: '2026-10-20T04:00:00Z' });
  const result = await recover(f); assert.equal(result.receipt.quoted, false); assert.equal(result.receipt.feeHeld, false);
});
test('actual recovery keeps a hold for a declaration covering a different payer', async () => {
  const f = fixture({ payer: 'own', feePayer: 'hivic' }); assert.equal((await recover(f)).receipt.feeHeld, true);
});
test('failed payer-change read rejects recovery instead of clearing a stale fee hold', async () => {
  const f = fixture({ feeAt: '2026-10-20T04:00:00Z', fail: failsEvent('installer_electrician_payer_changed') });
  await assert.rejects(() => recover(f), /could not load|could not be loaded|could not verify|retry/i); assert.equal(f.writes.length, 0);
});
test('failed explicit quote-answer read rejects recovery instead of falling back to a stale legacy answer', async () => {
  const f = fixture({ quoted: 'have_quote', legacyQuoted: 'no', feeAt: '2026-10-20T04:00:00Z', fail: failsEvent('installer_quote_answer') });
  await assert.rejects(() => recover(f), /could not load|could not be loaded|could not verify|retry/i); assert.equal(f.writes.length, 0);
});
test('failed legacy quote-answer read rejects recovery rather than reporting an unasked answer', async () => {
  const f = fixture({ fail: q => q.table === 'jobs' && q.columns === 'id, installer_quoted' });
  await assert.rejects(() => recover(f), /could not load|could not be loaded|could not verify|retry/i); assert.equal(f.writes.length, 0);
});
for (const electrician of [{ business_id: 'replacement' }, { nomination_id: 'replacement-nomination' }]) {
  test('actual own-to-own save refuses before any mutation: ' + Object.keys(electrician)[0], async () => {
    const f = fixture({ payer: 'own', feePayer: 'own' });
    await assert.rejects(() => f.intake.installerUpdateIntake('job', 'user', 'business', { files: [], insulation: 'none', quoteStatus: 'not_quoted', quoteIncGst: null, includes: null, electrician }), e => e.message === f.intake.OWN_ELECTRICIAN_OFFICE_CHANGE);
    assert.equal(f.writes.length, 0);
  });
}

const failsAnyEvent = event => q => q.table === 'workflow_events' && q.filters.some(([k, op, values]) => k === 'event_type' && op === 'in' && values.includes(event));
const canonicalReadFailures = [
  ['coordination', failsEvent('installer_coordination_chosen')],
  ['current job', q => q.table === 'jobs' && q.columns.startsWith('channel, installer_quoted_price_inc_gst')],
  ['latest insulation', failsAnyEvent('installer_existing_insulation_declared')],
  ['ceiling measurements', q => q.table === 'ceiling_measurements'],
  ['office eligibility', failsAnyEvent('installer_commercial_eligibility')],
  ['owner contact consent', q => q.table === 'owner_contact_consents'],
  ['fee declaration', failsEvent('installer_owner_fee_awareness')],
  ['Ready Check evidence', q => q.table === 'evidence_requirements'],
  ['fee declaration actor', q => q.table === 'profiles'],
  ['quote removal details', failsEvent('installer_quote_removal_declared')],
  ['proposed insulation', failsAnyEvent('installer_intake_updated')],
  ['quote reconfirmation', failsAnyEvent('installer_quote_reconfirmation_required')],
];
for (const [name, fail] of canonicalReadFailures) {
  test('actual recovery rejects a failed canonical read: ' + name, async () => {
    const f = fixture({ feeActor: 'actor', fail });
    await assert.rejects(() => recover(f), name === 'current job' ? /Injected history read failure/ : /could not load.*retry/i);
    assert.ok(f.reads.some(fail), 'The intended query must be reached');
    assert.equal(f.writes.length, 0);
  });
}
test('a missing exact fee count is a load failure, not evidence of no declaration', async () => {
  const f = fixture({ nullCount: failsEvent('installer_owner_fee_awareness') });
  await assert.rejects(() => recover(f), /fee declarations could not load.*retry/i);
  assert.equal(f.writes.length, 0);
});
test('successful absence of optional history preserves unknown and unanswered facts', async () => {
  const f = fixture({ noOptionalHistory: true, quoted: null });
  const state = await f.intake.installerIntakeState('job');
  const { receipt } = await recover(f);
  assert.equal(state.coordination, null); assert.equal(state.insulation, null);
  assert.equal(state.areaM2, null); assert.equal(state.proposedR, null);
  assert.equal(state.reconfirmationRequired, false); assert.equal(state.feeAwarenessRecorded, false);
  assert.equal(state.feeRecord, null); assert.equal(state.officeEligibility, 'unresolved');
  assert.equal(receipt.quoted, null); assert.equal(receipt.insulation, 'unknown'); assert.equal(receipt.feeHeld, true);
  assert.equal(f.writes.length, 0);
});
test('a successful missing actor profile stays explicitly unknown', async () => {
  const f = fixture({ feeActor: 'actor', profilePresent: false });
  assert.equal((await f.intake.installerIntakeState('job')).feeRecord.actorName, null);
  assert.equal(f.writes.length, 0);
});
for (const mode of ['read failure', 'missing exact count']) {
  test('the intake identity guard rejects ' + mode + ' before treating the job as non-intake', async () => {
    const predicate = failsEvent('installer_evidence_acknowledged');
    const f = fixture(mode === 'read failure' ? { fail: predicate } : { nullCount: predicate });
    await assert.rejects(() => f.intake.intakeSendBlockers('job'), /intake history could not load.*retry/i);
    assert.equal(f.writes.length, 0);
  });
}

// Fix B (20 Oct): the visit-answer read in getImportDraftFor must fail closed; a genuine null stays unknown.
const siteCheckRead = q => q.table === 'jobs' && q.columns === 'installer_site_check';
test('recovery rejects when the saved job visit-answer read fails, with zero writes', async () => {
  const f = fixture({ fail: siteCheckRead });
  await assert.rejects(() => recover(f), /visit answer could not load.*retry/i); assert.equal(f.writes.length, 0);
});
test('recovery rejects when the saved job row is missing, with zero writes', async () => {
  const f = fixture({ hide: siteCheckRead });
  await assert.rejects(() => recover(f), /saved job could not be found/i); assert.equal(f.writes.length, 0);
});
test('a genuine null visit answer stays unknown on the recovered receipt', async () => {
  const r = await recover(fixture()); assert.equal(r.receipt.attended, null);
});
test('a recorded visit answer is carried to the recovered receipt (attendance argument preserved)', async () => {
  assert.equal((await recover(fixture({ siteCheck: 'yes' }))).receipt.attended, 'attended');
  assert.equal((await recover(fixture({ siteCheck: 'no' }))).receipt.attended, 'not_attended');
});
