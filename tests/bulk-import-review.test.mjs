// Actual bulk source with isolated framework/storage/database boundaries. No live calls or writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.env.HIVIC_BULK_TEST_SOURCE_ROOT || repoRoot;
const testRequire = process.env.HIVIC_BULK_TEST_DEPS_ROOT
  ? createRequire(resolve(process.env.HIVIC_BULK_TEST_DEPS_ROOT, 'package.json')) : createRequire(import.meta.url);
const ts = testRequire('typescript');
function load(path, imports = {}, extra = '') {
  const compiled = ts.transpileModule(readFileSync(resolve(sourceRoot, path), 'utf8') + '\n' + extra,
    { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } });
  const errors = (compiled.diagnostics || []).filter(e => e.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, errors.map(e => ts.flattenDiagnosticMessageText(e.messageText, ' ')).join('\n'));
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputText)(name => {
    if (!(name in imports)) throw new Error('Unexpected actual-source dependency: ' + name);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}
const core = load('src/lib/bulk-import.core.ts');
const unexpected = name => () => { throw new Error('Unexpected external action: ' + name); };
const workflow = { WorkflowError: class WorkflowError extends Error {} };
const pilot = load('src/lib/pilot.core.ts', { './measurement.core': new Proxy({}, { get: (_, name) => unexpected('measurement ' + String(name)) }) });
const BATCH = '11111111-1111-4111-8111-111111111111';
const ORIGINAL = '14 Oak Street/quote.pdf';
const STORED = 'partners/business/imports/immutable-quote.pdf';
const matched = path => ({ path, name: path.split('/').pop(), how: 'folder' });

function accessFixture({ office = false, member = true, memberRole = 'business_admin', active = true, businessPatch = {}, manifest, rowFiles, fail = () => false, credentialCount, signed = { signedUrl: 'https://files.example.invalid/fixture' } } = {}) {
  const records = {
    bulk_import_batches: [{ id: BATCH, business_id: 'business', status: 'confirmed', file_manifest: manifest ?? [{ path: ORIGINAL, name: 'quote.pdf', type: 'application/pdf', stored_path: STORED }] }, { id: 'foreign-batch', business_id: 'foreign', file_manifest: [] }],
    bulk_import_rows: [{ id: 'row', batch_id: BATCH, status: 'confirmed', job_id: 'job', matched_files: rowFiles ?? [matched(ORIGINAL)] }, { id: 'foreign-row', batch_id: 'foreign-batch', status: 'confirmed', matched_files: [] }],
    business_members: member ? [{ business_id: 'business', user_id: 'actor', member_role: memberRole, active }] : [],
    businesses: [{ id: 'business', business_type: 'eec_installer', onboarding_status: 'approved', is_active: true, ...businessPatch }],
    business_credentials: [{ business_id: 'business', kind: 'public_liability_insurance', label: 'Fixture insurance', critical: true, verification: 'verified', expires_at: '2099-12-31' }],
  };
  const io = { reads: [], signs: [], writes: [] };
  class Query {
    constructor(table) { this.table = table; this.filters = []; }
    select(columns, opts = {}) { this.columns = columns; this.opts = opts; return this; }
    eq(k, v) { this.filters.push([k, v]); return this; }
    maybeSingle() { this.one = true; return this; }
    then(ok, bad) { return Promise.resolve().then(() => {
      const q = { table: this.table, columns: this.columns, filters: this.filters }; io.reads.push(q);
      if (fail(q)) return { data: null, count: null, error: { message: 'Injected ' + this.table + ' read failure' } };
      assert.ok(this.table in records, 'Unexpected table: ' + this.table);
      const rows = records[this.table].filter(r => this.filters.every(([k, v]) => r[k] === v));
      return { data: this.one ? rows[0] ?? null : rows, count: this.opts.count === 'exact' ? credentialCount !== undefined ? credentialCount : rows.length : null, error: null };
    }).then(ok, bad); }
    insert(value) { io.writes.push(value); throw new Error('Unexpected database write'); }
    update(value) { io.writes.push(value); throw new Error('Unexpected database write'); }
  }
  const admin = { from: table => new Query(table), rpc: async (name, args) => {
    assert.equal(name, 'has_role'); assert.deepEqual(args, { _user_id: 'actor', _role: 'admin' });
    const q = { table: 'has_role', columns: '', filters: [] }; io.reads.push(q);
    return fail(q) ? { data: null, error: { message: 'Injected role read failure' } } : { data: office, error: null };
  }, storage: { from: bucket => ({ createSignedUrl: async (path, seconds) => {
    io.signs.push({ bucket, path, seconds });
    return fail({ table: 'storage', filters: [] }) ? { data: null, error: { message: 'Stored file unavailable' } } : { data: signed, error: null };
  } }) } };
  io.api = load('src/lib/bulk-import-access.server.ts', { '@/integrations/supabase/client.server': { supabaseAdmin: admin }, './workflow.server': workflow, './pilot.core': pilot, './bulk-import.core': core });
  return io;
}

test('authorized historical preview resolves exact original identity to its private stored copy', async () => {
  const io = accessFixture(); assert.deepEqual(await io.api.bulkFilePreview('row', ORIGINAL, 'actor'), { url: 'https://files.example.invalid/fixture' });
  assert.deepEqual(io.signs, [{ bucket: 'job-files', path: STORED, seconds: 300 }]); assert.equal(io.writes.length, 0);
});
for (const [name, options, rowId, path] of [
  ['another row file', {}, 'row', '20 Elm Street/quote.pdf'],
  ['another business', {}, 'foreign-row', ORIGINAL],
  ['arbitrary stored path', {}, 'row', STORED],
  ['ambiguous original path', { manifest: [{ path: ORIGINAL, stored_path: STORED }, { path: ORIGINAL, stored_path: 'partners/business/imports/second.pdf' }] }, 'row', ORIGINAL],
  ['foreign stored mapping', { manifest: [{ path: ORIGINAL, stored_path: 'partners/foreign/imports/quote.pdf' }] }, 'row', ORIGINAL],
  ['traversal stored mapping', { manifest: [{ path: ORIGINAL, stored_path: 'partners/business/imports/../other.pdf' }] }, 'row', ORIGINAL],
  ['encoded stored traversal', { manifest: [{ path: ORIGINAL, stored_path: 'partners/business/imports/%2e%2e/other.pdf' }] }, 'row', ORIGINAL],
  ['unrecorded stored copy', { manifest: [{ path: ORIGINAL }] }, 'row', ORIGINAL],
]) test('preview refuses ' + name + ' before signing anything', async () => {
  const io = accessFixture(options); await assert.rejects(() => io.api.bulkFilePreview(rowId, path, 'actor'));
  assert.equal(io.signs.length, 0); assert.equal(io.writes.length, 0);
});
test('a recorded manual attachment can preview only its own authorized import path', async () => {
  const io = accessFixture({ manifest: [], rowFiles: [{ path: STORED, name: 'quote.pdf', how: 'added' }] });
  await io.api.bulkFilePreview('row', STORED, 'actor'); assert.equal(io.signs[0].path, STORED);
});
for (const table of ['has_role', 'business_members', 'bulk_import_rows', 'bulk_import_batches', 'storage']) test('preview reports a failed ' + table + ' read', async () => {
  const io = accessFixture({ fail: q => q.table === table }); await assert.rejects(() => io.api.bulkFilePreview('row', ORIGINAL, 'actor'), /could not|Could not/i); assert.equal(io.writes.length, 0);
});
test('preview does not report success if storage returned no signed URL', async () => {
  const io = accessFixture({ signed: {} }); await assert.rejects(() => io.api.bulkFilePreview('row', ORIGINAL, 'actor'), /could not be opened/);
});
for (const options of [{ member: false }, { memberRole: 'worker' }, { active: false }]) test('preview requires current active business-admin membership: ' + JSON.stringify(options), async () => {
  const io = accessFixture(options); await assert.rejects(() => io.api.bulkFilePreview('row', ORIGINAL, 'actor'), /active business admin/); assert.equal(io.signs.length, 0);
});
test('history remains readable when approval is suspended, while new work rechecks current approval', async () => {
  const io = accessFixture({ businessPatch: { onboarding_status: 'suspended' } });
  await io.api.bulkFilePreview('row', ORIGINAL, 'actor'); await assert.rejects(() => io.api.bulkBusinessAccess('actor', 'business', true), /suspended.*approval required/); assert.equal(io.writes.length, 0);
});
for (const [name, options] of [
  ['business read', { fail: q => q.table === 'businesses' }],
  ['credentials read', { fail: q => q.table === 'business_credentials' }],
  ['missing credential count', { credentialCount: null }],
  ['capped credential result', { credentialCount: 1001 }],
  ['wrong business type', { businessPatch: { business_type: 'rec' } }],
]) test('new work rejects an unverified approval check: ' + name, async () => {
  const io = accessFixture(options); await assert.rejects(() => io.api.bulkBusinessAccess('actor', 'business', true)); assert.equal(io.writes.length, 0);
});

const row = (id, status = 'confirmed', job = 'job-' + id) => ({ id, row_index: Number(id) || 0, status, job_id: job, extracted: { full_name: 'Customer ' + id, address_line: '14 Oak Street', suburb: 'Richmond', postcode: '3121', phone: '0412345678', email: 'fixture@example.invalid' }, matched_files: [matched(ORIGINAL)], sort_result: 'needs_visit', sort_reasons: [], missing_evidence: [], import_stage: 'not_visited', electrician_plan: null });
const closedRows = () => [row('1'),row('2'),row('3'),row('4'),row('5'),row('6','skipped',null)];
test('counts distinguish skipped, unfinished and broken legacy job links from added jobs', () => {
  const rows = [...closedRows(), row('7','pending','partial-job'), row('8','confirmed',null)];
  assert.deepEqual(core.bulkCounts(rows), { found: 8, added: 5, skipped: 1, pending: 1, needsRepair: 1 });
  assert.match(core.bulkCountsLabel(core.bulkCounts(rows)), /1 unfinished · 1 need Office review/);
});
test('canonical source matching preserves full folders and rejects ambiguous root basenames', () => {
  const paths = ['quote.pdf','14 Oak/quote.pdf']; assert.equal(core.sourceFileMatches('quote.pdf', 'quote.pdf', paths), false); assert.equal(core.sourceFileMatches('quote.pdf', '14 Oak/quote.pdf', paths), false);
  assert.equal(core.sourceFileMatches('14 Oak\\quote.pdf','14 Oak/quote.pdf',paths), true);
  assert.equal(core.sourceFileMatches('14 Oak/quote.pdf','20 Elm/quote.pdf',['14 Oak/quote.pdf','20 Elm/quote.pdf']), false);
});
test('canonical case-collision files cannot become automatic heuristic matches', () => {
  const paths = ['14 Oak Street/quote.pdf','14 OAK STREET/QUOTE.pdf']; const files = paths.map(path => ({ path, name: path.split('/').pop(), folder: path.split('/')[0], type: 'application/pdf', gps_lat: null, gps_lng: null }));
  assert.deepEqual(core.linkFiles([{ address_line: '14 Oak Street' }], files)[0].matched, []);
});
test('photo, GPS, quote and measurements do not infer an attended site check', () => {
  const facts = { area_m2: 150, price_inc_gst: 9000, existing_insulation: 'none', source_files: ['photo.jpg'], gps_lat: -37.8, gps_lng: 145 };
  assert.equal(core.hasVisitEvidence(facts, 6), false); assert.equal(core.effectiveSiteCheck(facts, 6).check, null);
  assert.equal(core.effectiveSiteCheck({ ...facts, site_check: 'yes', site_check_date: '2026-10-19' }, 6).check, 'yes');
});
