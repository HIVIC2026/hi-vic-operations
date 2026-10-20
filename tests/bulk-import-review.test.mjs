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

const h = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity).filter(x => x !== null && x !== undefined && x !== false) });
const text = node => node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : (node.children ?? []).map(text).join('');
const all = (node, predicate) => !node || typeof node !== 'object' ? [] : [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap(child => all(child, predicate))];
const byText = (tree, label) => all(tree, n => !!n.props.onClick && text(n) === label)[0];
function uiFixture(t, { url = 'https://portal.example.invalid/partner/bulk-import', review, past = [], previewError = null, zipEntries = {} } = {}) {
  const previous = { React: globalThis.React, window: globalThis.window };
  t.after(() => Object.assign(globalThis, previous)); globalThis.React = { createElement: h, Fragment: 'Fragment' };
  const io = { calls: [], opened: [], effects: [], state: new Map(), queryKeys: [], zipReads: 0, tree: null };
  let location = new URL(url); globalThis.window = { get location() { return { href: location.href, search: location.search }; }, history: { state: {}, replaceState(_state, _title, next) { location = new URL(next); } } };
  let active, dirty = false, root;
  function slot(initial) { const key = active.key + ':' + active.cursor++; if (!io.state.has(key)) io.state.set(key, typeof initial === 'function' ? initial() : initial); return key; }
  const hooks = {
    useState(initial) { const key = slot(initial); return [io.state.get(key), value => { const next = typeof value === 'function' ? value(io.state.get(key)) : value; if (!Object.is(next, io.state.get(key))) { io.state.set(key, next); dirty = true; } }]; },
    useRef(initial) { return io.state.get(slot(() => ({ current: initial }))); },
    useEffect(fn, deps) { const key = active.key + ':effect:' + active.cursor++; const old = io.state.get(key); if (!old || !deps || deps.some((d, i) => !Object.is(d, old[i]))) { io.state.set(key, deps); io.effects.push(fn); } },
  };
  const action = name => async args => { io.calls.push({ name, args }); if (name === 'bulkImportFileUrl') { if (previewError) throw new Error(previewError); return { url: 'https://files.example.invalid/fixture' }; } throw new Error('Unexpected mutation or live handler: ' + name); };
  const rpcNames = ['bulkImportFileUrl','repairBulkImportFiles','addBulkRowFiles','removeBulkRowFile','addBulkElectrician','bulkBatchReview','bulkElectricianChoices','bulkImportBusinesses','confirmBulkBatch','createBulkBatch','geocodeBulkPhotos','listBulkBatches','readBulkFile','readBulkRows','setBulkReviewPlan','setBulkRowAddress'];
  const rpc = Object.fromEntries(rpcNames.map(name => [name, action(name)]));
  const common = { react: hooks, '@tanstack/react-start': { useServerFn: fn => fn }, '@/lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    'lucide-react': Object.fromEntries(['Camera','FileText','Paperclip','X','Zap','Check','ChevronDown','UploadCloud'].map(name => [name, name])),
    '@/lib/job-electrician.core': { usualElectrician: () => null, electricianPlanBlocker: unexpected('unrelated electrician planning'), newElectricianProblems: unexpected('unrelated electrician editing') } };
  const attachments = load('src/components/trade/job-intake.tsx', { ...common, '@/integrations/supabase/client': {}, '@/lib/pilot.functions': { partnerFileUrl: action('partnerFileUrl'), partnerUploadUrl: action('partnerUploadUrl') },
    '@/lib/job-electrician.functions': {}, '@/components/ui/button': { Button: 'button' }, '@/components/portal/file-viewer': { openFileViewer: (url, name) => io.opened.push({ url, name }) } });
  const query = { useQueryClient: () => ({ invalidateQueries: async () => {} }), useQuery: options => {
    io.queryKeys.push(options.queryKey);
    const kind = options.queryKey[0];
    return { data: kind === 'bulk-biz' ? { businesses: [{ id: 'business', name: 'Fixture installer' }], isAdmin: false } : kind === 'bulk-past' ? { batches: past } : kind === 'bulk-review' && options.enabled && options.queryKey[1] === BATCH ? review : undefined, refetch: async () => {} };
  } };
  io.module = load('src/routes/_authenticated/partner.bulk-import.tsx', { ...common, '@tanstack/react-router': { createFileRoute: () => options => options, redirect: unexpected('navigation') },
    '@/lib/route-guards': {}, '@tanstack/react-query': query, '@/lib/bulk-import.functions': rpc, '@/components/ui/checkbox': { Checkbox: 'Checkbox' }, '@/components/ui/input': { Input: 'input' },
    sonner: { toast: Object.fromEntries(['success','warning','info','error'].map(name => [name, message => io.calls.push({ name: 'toast.' + name, message })])) }, '@/lib/bulk-import.core': core,
    '@/components/trade/TradeShell': { TradeShell: 'TradeShell' }, '@/components/trade/job-intake': { ...attachments, ElectricianPicker: 'ElectricianPicker' },
    jszip: { default: { loadAsync: async () => { io.zipReads++; return { files: zipEntries }; } } },
  }, 'export { BulkImportPage, BulkHistoryRow, CustomerCard, collect };');
  function invoke(fn, props, key) { const before = active; active = { key, cursor: 0 }; try { return fn(props); } finally { active = before; } }
  function expand(node, key) { if (!node || typeof node !== 'object') return node; if (typeof node.type === 'function') return { ...node, children: [expand(invoke(node.type, { ...node.props, children: node.children }, key), key + ':body')] }; return { ...node, children: node.children.map((child, i) => expand(child, key + ':' + (child?.props?.key ?? i))) }; }
  io.render = (fn = io.module.BulkImportPage, props = {}) => { root = { fn, props }; return io.flush(); };
  io.flush = () => { for (let n = 0; n < 20; n++) { dirty = false; io.tree = expand(invoke(root.fn, root.props, 'root'), 'root'); const effects = io.effects.splice(0); effects.forEach(fn => fn()); if (!dirty) return io.tree; } throw new Error('Fixture render did not settle'); };
  io.url = () => location.href; io.attachments = attachments; return io;
}
const row = (id, status = 'confirmed', job = 'job-' + id) => ({ id, row_index: Number(id) || 0, status, job_id: job, extracted: { full_name: 'Customer ' + id, address_line: '14 Oak Street', suburb: 'Richmond', postcode: '3121', phone: '0412345678', email: 'fixture@example.invalid' }, matched_files: [matched(ORIGINAL)], sort_result: 'needs_visit', sort_reasons: [], missing_evidence: [], import_stage: 'not_visited', electrician_plan: null });
const closedRows = () => [row('1'),row('2'),row('3'),row('4'),row('5'),row('6','skipped',null)];
function reviewFor(rows, status = 'confirmed') { return { batch: { id: BATCH, business_id: 'business', status, summary: { rows: 999 } }, rows, counts: core.bulkCounts(rows), isAdmin: false }; }
function assertClosed(tree) {
  const history = all(tree, n => n.props['data-bulk-history'] !== undefined)[0]; assert.ok(history); assert.match(text(history), /6 found · 5 added · 1 skipped/);
  assert.equal(all(history, n => n.props['data-customer-card'] !== undefined).length, 0);
  assert.equal(all(history, n => n.props['data-confirm-bar'] !== undefined || n.props['aria-label'] === 'Owner consent').length, 0);
  assert.equal(all(history, n => (n.type === 'input' || n.type === 'select' || n.type === 'Checkbox') && !n.props.disabled).length, 0);
  assert.equal(all(history, n => /^(Don't add|Confirm \d|Take photo|Choose files|Remove )/.test(n.props['aria-label'] ?? text(n)) && !!n.props.onClick).length, 0);
  assert.equal(all(history, n => n.props['data-bulk-history-row'] !== undefined).length, 6);
  return history;
}
test('closed upload opened by URL uses persisted true counts and read-only controls', t => {
  const review = reviewFor(closedRows()); const before = JSON.stringify(review);
  const io = uiFixture(t, { url: 'https://portal.example.invalid/partner/bulk-import?batch=' + BATCH, review });
  assertClosed(io.render()); assert.equal(new URL(io.url()).searchParams.get('batch'), BATCH); assert.equal(JSON.stringify(review), before); assert.equal(io.calls.length, 0);
});
test('closed upload remains read-only after a fresh mount at the persisted refresh URL', t => {
  const review = reviewFor(closedRows()); const first = uiFixture(t, { url: 'https://portal.example.invalid/partner/bulk-import?batch=' + BATCH, review }); first.render();
  const refreshed = uiFixture(t, { url: first.url(), review }); assertClosed(refreshed.render()); assert.equal(refreshed.calls.length, 0);
});
test('past-history click opens closed persisted outcomes without restoring the edit form', t => {
  const review = reviewFor(closedRows()); const io = uiFixture(t, { review, past: [{ id: BATCH, list_filename: 'Fixture six customers', created_at: '2026-10-20T10:00:00Z', status: 'confirmed', counts: review.counts }] });
  const start = io.render(); const historyButton = all(start, n => n.type === 'button' && !!n.props.onClick && text(n).includes('Fixture six customers'))[0]; assert.ok(historyButton); historyButton.props.onClick();
  assertClosed(io.flush()); assert.equal(new URL(io.url()).searchParams.get('batch'), BATCH); assert.equal(io.calls.length, 0);
});
test('partial pending job keeps intake locked while its authorized preview stays enabled', async t => {
  const pendingRow = row('1','pending','partially-created-job'); pendingRow.confirm_error = 'The original stored file is unavailable; retry after repair.';
  const io = uiFixture(t, { url: 'https://portal.example.invalid/partner/bulk-import?batch=' + BATCH, review: reviewFor([pendingRow], 'analysed') });
  const tree = io.render(); const card = all(tree, n => n.props['data-bulk-history-row'] !== undefined)[0]; assert.ok(card);
  assert.match(text(card), /Job started — confirm again to finish it/); assert.match(text(card), /original stored file is unavailable/);
  assert.equal(all(card, n => n.props['aria-label'] === 'Owner consent' || n.props['data-customer-card'] !== undefined).length, 0);
  const open = all(card, n => n.props['aria-label'] === 'Open quote.pdf')[0]; assert.ok(open); assert.ok(!open.props.disabled); await open.props.onClick();
  assert.deepEqual(io.calls, [{ name: 'bulkImportFileUrl', args: { data: { rowId: '1', originalPath: ORIGINAL } } }]); assert.equal(io.opened.length, 1);
});
test('a missing-file preview reports the error while keeping immutable history and no false open success', async t => {
  const io = uiFixture(t, { previewError: 'This upload file could not be opened: missing stored object' });
  const props = { row: row('1'), businessId: 'business', canRepair: false }; const before = JSON.stringify(props.row);
  const tree = io.render(io.module.BulkHistoryRow, props); await all(tree, n => n.props['aria-label'] === 'Open quote.pdf')[0].props.onClick();
  assert.match(text(io.flush()), /missing stored object/); assert.equal(io.opened.length, 0); assert.equal(JSON.stringify(props.row), before); assert.equal(io.calls.length, 1);
});
test('duplicate intake wording refers to the one retained customer card', t => {
  const io = uiFixture(t); const duplicate = row('1','pending',null); duplicate.extracted.notes = 'Listed 3 times in the upload';
  const props = { row: duplicate, businessId: 'business', status: { ready: true, text: 'Ready', excluded: false }, skipped: false, consent: false, quoted: { answer: null, price: '', confirmed: false }, check: { check: null, date: null }, electrician: null,
    onLead() {}, onSaving() {}, onSkip: unexpected('skip'), onConsent: unexpected('consent'), onQuoted: unexpected('quote'), onCheck: unexpected('attendance') };
  const tree = io.render(io.module.CustomerCard, props); const note = all(tree, n => n.props['data-repeat-note'] !== undefined)[0]; assert.ok(note); assert.match(text(note), /kept one customer card/); assert.doesNotMatch(text(note), /pick one|choose one/i);
});

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
const bytes = () => new TextEncoder().encode('fixture text').buffer;
const readers = { readMedia: unexpected('media service'), geocode: unexpected('geocode service'), progress() {} };
test('actual collector retains folder and ZIP members by full relative path without replacing same basenames', async t => {
  let memberRead = 0; const io = uiFixture(t, { zipEntries: { '20 Elm Street/quote.txt': { dir: false, _data: { uncompressedSize: 12 }, async: async () => { memberRead++; return bytes(); } } } });
  const result = await io.module.collect([{ name: 'quote.txt', type: 'text/plain', size: 12, webkitRelativePath: '14 Oak Street/quote.txt', arrayBuffer: async () => bytes() }, { name: 'batch.zip', type: 'application/zip', size: 100, arrayBuffer: async () => bytes() }], readers);
  assert.deepEqual([...result.bytes.keys()], ['14 Oak Street/quote.txt','20 Elm Street/quote.txt']); assert.deepEqual(result.manifest.map(f => f.path), [...result.bytes.keys()]); assert.equal(memberRead, 1); assert.equal(io.zipReads, 1);
});
test('actual collector rejects oversized/unknown ZIP members before decompressing their bytes', async t => {
  let decompressed = 0; const io = uiFixture(t, { zipEntries: {
    'oversize.pdf': { dir: false, _data: { uncompressedSize: 50_000_001 }, async: async () => { decompressed++; return bytes(); } },
    'unknown.pdf': { dir: false, _data: {}, async: async () => { decompressed++; return bytes(); } },
  } });
  const result = await io.module.collect([{ name: 'batch.zip', size: 100, arrayBuffer: async () => bytes() }], readers);
  assert.equal(decompressed, 0); assert.equal(result.bytes.size, 0); assert.match(result.reads[0].message, /over 50 MB/); assert.match(result.reads[1].message, /size couldn't be checked/);
});
test('actual collector enforces the aggregate 500 MB bound before reading the next folder member', async t => {
  const io = uiFixture(t); const read = [];
  const files = Array.from({ length: 11 }, (_, n) => ({ name: 'quote-' + n + '.txt', type: 'text/plain', size: 50_000_000, webkitRelativePath: 'customer-' + n + '/quote.txt', arrayBuffer: async () => { read.push(n); return bytes(); } }));
  const result = await io.module.collect(files, readers); assert.equal(read.length, 10); assert.equal(result.bytes.size, 10); assert.match(result.reads.at(-1).message, /over 500 MB/);
});
test('actual collector rejects oversized outer ZIPs and unsafe relative paths', async t => {
  const io = uiFixture(t); let read = 0;
  const result = await io.module.collect([{ name: 'huge.zip', size: 500_000_001, arrayBuffer: async () => { read++; return bytes(); } }, { name: 'quote.txt', type: 'text/plain', size: 12, webkitRelativePath: '../foreign/quote.txt', arrayBuffer: async () => bytes() }], readers);
  assert.equal(read, 0); assert.equal(io.zipReads, 0); assert.equal(result.bytes.size, 0); assert.match(result.reads[0].message, /ZIP is over 500 MB/); assert.match(result.reads[1].message, /unsafe file path/);
});
