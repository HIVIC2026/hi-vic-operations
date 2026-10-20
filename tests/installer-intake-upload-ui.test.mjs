// Actual callers and AttachFiles with isolated React, storage and RPC boundaries. No live calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = process.env.HIVIC_INTAKE_UPLOAD_TEST_SOURCE_ROOT || repo;
const base = process.env.HIVIC_INTAKE_UPLOAD_TEST_BASE_ROOT || root;
const deps = process.env.HIVIC_INTAKE_UPLOAD_TEST_DEPS_ROOT;
const require = deps ? createRequire(resolve(deps, 'package.json')) : createRequire(import.meta.url);
const ts = require('typescript');
const read = path => readFileSync(existsSync(resolve(root, path)) ? resolve(root, path) : resolve(base, path), 'utf8');
const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(x => x !== false && x != null) });
const text = n => n == null || typeof n === 'boolean' ? '' : typeof n !== 'object' ? String(n) : (n.children || []).map(text).join('');
const all = (n, predicate) => !n || typeof n !== 'object' ? [] : [...(predicate(n) ? [n] : []), ...(n.children || []).flatMap(x => all(x, predicate))];
const button = (tree, label) => { const found = all(tree, n => n.type === 'button' && text(n) === label)[0]; assert.ok(found, 'Button: ' + label); return found; };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const unexpected = name => () => { throw new Error('Unexpected external operation: ' + name); };
const compiled = new Map();
function load(path, imports = {}, globals = {}, override) {
  const source = override || read(path);
  if (!compiled.has(source)) {
    const out = ts.transpileModule(source, { fileName: path, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } });
    const errors = (out.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    assert.equal(errors.length, 0, errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, ' ')).join('\n'));
    compiled.set(source, out.outputText);
  }
  const module = { exports: {} };
  new Function('React', 'require', 'module', 'exports', ...Object.keys(globals), compiled.get(source))({ createElement: h, Fragment: 'Fragment' }, name => {
    if (!(name in imports)) throw new Error('Unexpected source dependency: ' + name);
    return imports[name];
  }, module, module.exports, ...Object.values(globals));
  return module.exports;
}
const removal = load('src/lib/intake-quote-details.core.ts');
const core = load('src/lib/installer-intake.core.ts', { './intake-quote-details.core': removal });
// Customer/electrical validation is outside this upload regression; existing intake/file rules remain actual source.
const flowCore = load('src/lib/add-job-flow.core.ts', { './onsite-ready-check.core': { onsiteProblems: () => [] }, './later-ready-check.core': {}, './installer-quote-intake.core': {} });
const legacy = { path: 'partners/business/imports/legacy.pdf', name: 'legacy.pdf', type: 'application/pdf' };
const supporting = { path: 'partners/business/imports/photo.jpg', name: 'photo.jpg', type: 'image/jpeg', purpose: 'supporting' };
const quote = { path: 'partners/business/imports/quote.doc', name: 'quote.doc', type: 'application/msword', purpose: 'quote' };
const picked = name => new File(['isolated fixture'], name, { type: 'application/msword' });

function fixture(t, { mode = 'flow', files = [], existingDraft = false, storage, create, attach, remove, save, quoteAmount = 1200 } = {}) {
  const io = { calls: [], persisted: files.map(f => ({ ...f })), state: new Map(), effects: [], tree: null };
  const calls = name => io.calls.filter(c => c.name === name);
  const record = (name, action) => async args => { io.calls.push({ name, args }); return action(args); };
  const facts = { applies: true, businessId: 'business', areaM2: 120, insulation: 'none', quoteAnswer: 'have_quote', quoted: 'yes', attended: 'attended', quoteIncGst: quoteAmount, includes: quoteAmount == null ? null : 'R5 batts', proposedR: 5, files: io.persisted, electricianChosen: true, electricianPayer: 'hivic', feeAwarenessCurrent: true, quoteHeld: [], payerEditable: false };
  const rpc = {
    partnerFileUrl: record('preview', async () => ({ url: 'https://files.example.invalid/fixture' })),
    partnerUploadUrl: record('signUpload', async ({ data }) => ({ path: 'partners/business/imports/' + calls('signUpload').length + '-' + data.fileName, token: 'fixture' })),
    createImport: record('create', async args => { if (create) await create(args); io.persisted = args.data.files.map(f => ({ ...f })); return { id: 'draft' }; }),
    addImportFiles: record('attach', async args => { if (attach) await attach(args, calls('attach').length); for (const f of args.data.files) if (!io.persisted.some(x => x.path === f.path)) io.persisted.push({ ...f }); return { files: io.persisted.map(f => ({ ...f })) }; }),
    removeImportFile: record('remove', async args => { if (remove) await remove(args); io.persisted = io.persisted.filter(f => f.path !== args.data.path); return { files: io.persisted.map(f => ({ ...f })) }; }),
    getImportDraft: record('restore', async () => ({ status: 'draft', files: io.persisted, jobId: null })),
    confirmImport: record('confirm', async () => ({ jobId: 'job', jobNumber: 'HV-TEST' })),
    saveMyIntakeJob: record('save', async args => { if (save) await save(args); io.persisted.push(...args.data.files); facts.files = io.persisted; return { quoteHeld: [] }; }),
    getMyIntakeJob: unexpected('live job load'), getMyIntakeReadyCheck: unexpected('live Ready Check'),
  };
  const supabase = { auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } } }) }, storage: {} };
  // Keep the real useUploadFiles call chain, replacing only provider I/O.
  supabase.storage.from = bucket => { assert.equal(bucket, 'job-files'); return { uploadToSignedUrl: async (path, token, file) => {
    io.calls.push({ name: 'upload', args: { path, file } }); if (storage) await storage(file, calls('upload').length); return { error: null };
  } }; };
  const savedDraft = { customer: { full_name: 'TEST Person', address_line: '1 Test Street', suburb: 'Melbourne', postcode: '3000', email: 'fixture@example.invalid', phone: '0400000000' }, d: { area: '120', amount: quoteAmount == null ? '' : String(quoteAmount), includes: 'R5 batts', proposedR: '5', insulation: 'none', quoteStatus: 'have_quote', attended: 'attended' }, coord: 'hivic_managed', payer: 'hivic', step: 'job', ...(existingDraft ? { draftId: 'draft' } : {}) };
  const memory = new Map([['hiv-intake:fixture-user:business', JSON.stringify(savedDraft)]]);
  const store = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const globals = { localStorage: store, sessionStorage: { removeItem() {} } };
  let active, dirty = false, rootView;
  const slot = initial => { const key = active.key + ':' + active.cursor++; if (!io.state.has(key)) io.state.set(key, typeof initial === 'function' ? initial() : initial); return key; };
  const hooks = {
    useState(initial) { const key = slot(initial); return [io.state.get(key), value => { const next = typeof value === 'function' ? value(io.state.get(key)) : value; if (!Object.is(next, io.state.get(key))) { io.state.set(key, next); dirty = true; } }]; },
    useRef(initial) { return io.state.get(slot(() => ({ current: initial }))); },
    useEffect(action, deps) { const key = active.key + ':effect:' + active.cursor++; const old = io.state.get(key); if (!old || !deps || deps.some((v, i) => !Object.is(v, old[i]))) { io.state.set(key, deps); io.effects.push(action); } },
  };
  const common = { react: hooks, '@tanstack/react-start': { useServerFn: fn => fn }, '@tanstack/react-query': { useQueryClient: () => ({}), useQuery: opts => ({ data: opts.queryKey[0] === 'my-intake-job' ? facts : { approved: [], pending: [] }, refetch: async () => {} }) },
    '@/integrations/supabase/client': { supabase }, '@/lib/pilot.functions': rpc, '@/lib/installer-quote.functions': rpc, '@/lib/bulk-import.functions': {},
    '@/lib/job-electrician.core': { usualElectrician: () => null, electricianPlanBlocker: () => null, newElectricianProblems: unexpected('electrician edit') },
    '@/components/trade/trade-ui': { Button: 'button' }, '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' }, '@/components/ui/textarea': { Textarea: 'textarea' }, '@/components/ui/checkbox': { Checkbox: 'checkbox' },
    '@/lib/installer-intake.core': core, '@/lib/intake-quote-details.core': removal,
  };
  const attachmentRoot = process.env.HIVIC_INTAKE_UPLOAD_TEST_ATTACHMENTS_ROOT;
  const attachments = load('src/components/trade/job-intake.tsx', { ...common, '@/lib/job-electrician.functions': {}, '@/lib/utils': { cn: (...x) => x.filter(Boolean).join(' ') }, 'lucide-react': Object.fromEntries(['Camera','FileText','Paperclip','X','Zap'].map(x => [x, x])), '@/components/portal/file-viewer': { openFileViewer: unexpected('viewer') } }, globals,
    attachmentRoot ? readFileSync(resolve(attachmentRoot, 'src/components/trade/job-intake.tsx'), 'utf8') : undefined);
  const imports = { ...common, './job-intake': { ...attachments, ElectricianPicker: 'ElectricianPicker' }, './intake-quote-fields': { ProposedRField: 'ProposedRField', RemovalQuoteFields: 'RemovalQuoteFields' }, './job-cache': { refreshInstallerJob: record('refresh', async () => {}) } };
  const flow = load('src/components/trade/installer-intake-flow.tsx', { ...imports, '@tanstack/react-router': { Link: 'Link' }, './customer-fields': { CustomerFields: 'CustomerFields' }, '@/lib/add-job-flow.core': flowCore }, globals);
  const editor = load('src/components/trade/intake-details-editor.tsx', imports, globals);
  function invoke(fn, props, key) { const before = active; active = { key: key + ':' + fn.name, cursor: 0 }; try { return fn(props); } finally { active = before; } }
  function expand(node, key) { if (!node || typeof node !== 'object') return node; if (typeof node.type === 'function') return { ...node, children: [expand(invoke(node.type, { ...node.props, children: node.children }, key), key + ':body')] }; return { ...node, children: node.children.map((c, i) => expand(c, key + ':' + (c?.props?.key ?? i))) }; }
  io.flush = () => { for (let n = 0; n < 20; n++) { dirty = false; io.tree = expand(invoke(rootView.fn, rootView.props, 'root'), 'root'); io.effects.splice(0).forEach(fn => fn()); if (!dirty) return io.tree; } throw new Error('Render did not settle'); };
  io.settle = async () => { for (let n = 0; n < 8; n++) { await Promise.resolve(); io.flush(); } return io.tree; };
  rootView = mode === 'flow' ? { fn: flow.InstallerIntakeFlow, props: { businessId: 'business' } } : mode === 'card' ? { fn: editor.MyIntakeDetailsCard, props: { jobId: 'job' } } : { fn: editor.IntakeDetailsEditor, props: { facts, businessId: 'business', upload: attachments.useUploadFiles('business'), onSave: args => rpc.saveMyIntakeJob({ data: args }) } };
  io.start = async () => { io.flush(); await io.settle(); if (mode !== 'flow') { button(io.tree, 'Add or update details').props.onClick(); io.flush(); } return io.tree; };
  io.attachments = () => all(io.tree, n => n.type === attachments.AttachFiles);
  io.control = purpose => { const c = io.attachments().find(n => purpose === 'quote' ? n.props.label === 'Upload your quote' : n.props.label.startsWith('Supporting')); assert.ok(c, purpose + ' control'); return c; };
  io.pick = (control, file) => { const input = all(control, n => n.type === 'input' && n.props['aria-label'] === 'Choose files')[0]; assert.ok(input); return input.props.onChange({ target: { files: [file] } }); };
  io.callsOf = calls; io.facts = facts; return io;
}

test('restored Add Job separates legacy quote, tagged quote and supporting originals without retagging', async t => {
  const files = [legacy, quote, supporting]; const before = JSON.stringify(files);
  const io = fixture(t, { files, existingDraft: true, quoteAmount: null }); await io.start();
  assert.deepEqual(io.control('quote').props.files.map(f => f.path), [legacy.path, quote.path]);
  assert.deepEqual(io.control('supporting').props.files.map(f => f.path), [supporting.path]);
  assert.equal(core.quoteFileCount(io.control('quote').props.files), 2);
  assert.equal(JSON.stringify(io.persisted), before); assert.equal(JSON.stringify(files), before);
});
for (const [name, files, expected] of [['legacy', [legacy], /uploaded quote/], ['supporting-only', [supporting], /amount still needed/]]) test('editor quote summary and file sections agree for ' + name, async t => {
  const io = fixture(t, { mode: 'editor', files, quoteAmount: null }); await io.start();
  const known = all(io.tree, n => n.props['data-intake-known'] !== undefined)[0]; assert.match(text(known), expected);
  assert.equal(io.control('quote').props.files.length, name === 'legacy' ? 1 : 0);
  assert.equal(io.control('supporting').props.files.length, name === 'legacy' ? 0 : 1);
  assert.deepEqual(io.persisted, files);
});
for (const mode of ['flow', 'editor']) test(mode + ': same-render sibling upload is rejected without releasing the active lock', async t => {
  const gate = deferred(); t.after(() => gate.resolve());
  const io = fixture(t, { mode, storage: () => gate.promise }); await io.start();
  const first = io.control('supporting'), second = io.control('quote');
  const next = button(io.tree, mode === 'flow' ? 'Back' : 'Save details');
  const a = io.pick(first, picked('support.doc')); const b = io.pick(second, picked('price.doc'));
  await io.settle();
  assert.equal(io.callsOf('upload').length, 1); assert.equal(io.callsOf('signUpload').length, 1);
  assert.ok(io.attachments().every(c => c.props.disabled)); assert.match(text(io.tree), /still running/);
  await next.props.onClick(); io.flush();
  if (mode === 'flow') assert.equal(all(io.tree, n => n.props['data-installer-intake'] !== undefined)[0].props['data-step'], 'job');
  assert.equal(io.callsOf('save').length, 0);
  gate.resolve(); await Promise.all([a, b]); await io.settle();
  assert.ok(io.attachments().every(c => !c.props.disabled));
  await io.pick(io.control('quote'), picked('price.doc')); await io.settle();
  assert.equal(io.callsOf('upload').length, 2);
  if (mode === 'flow') assert.equal(io.callsOf('create').length, 1, 'Both files reuse the first draft');
  assert.equal(io.control('quote').props.files[0].purpose, 'quote');
  assert.equal(io.control('supporting').props.files[0].purpose, 'supporting');
});
test('Add Job pending attachment retry keeps the stored original and its purpose', async t => {
  const io = fixture(t, { existingDraft: true, attach: (_args, n) => { if (n === 1) throw new Error('Injected attachment failure'); } }); await io.start();
  const file = picked('support.doc'); await io.pick(io.control('supporting'), file); await io.settle();
  assert.match(text(io.tree), /attachment could not be confirmed/); assert.equal(io.callsOf('upload').length, 1);
  assert.ok(io.attachments().every(c => !c.props.disabled));
  await io.pick(io.control('supporting'), file); await io.settle();
  assert.equal(io.callsOf('upload').length, 1); assert.equal(io.callsOf('attach').length, 2); assert.equal(io.callsOf('create').length, 0);
  assert.equal(io.persisted.length, 1); assert.equal(io.persisted[0].purpose, 'supporting');
});
test('Add Job removal owns the same lock as both upload controls', async t => {
  const gate = deferred(); t.after(() => gate.resolve());
  const io = fixture(t, { files: [quote], existingDraft: true, remove: () => gate.promise }); await io.start();
  const q = io.control('quote'), s = io.control('supporting');
  const drop = all(q, n => n.type === 'button' && n.props['aria-label'] === 'Remove quote.doc')[0]; assert.ok(drop);
  const a = drop.props.onClick(); const b = io.pick(s, picked('support.doc')); await io.settle();
  assert.equal(io.callsOf('remove').length, 1); assert.equal(io.callsOf('upload').length, 0);
  assert.deepEqual(io.persisted, [quote]); assert.ok(io.attachments().every(c => c.props.disabled));
  gate.resolve(); await Promise.all([a, b]); await io.settle(); assert.equal(io.persisted.length, 0);
});
test('editor save blocks stale upload callbacks and duplicate same-tick saves', async t => {
  const gate = deferred(); t.after(() => gate.resolve());
  const io = fixture(t, { mode: 'editor', save: () => gate.promise }); await io.start();
  const save = button(io.tree, 'Save details'), upload = io.control('supporting');
  const a = save.props.onClick(); const b = io.pick(upload, picked('support.doc')); const c = save.props.onClick(); await io.settle();
  assert.equal(io.callsOf('save').length, 1); assert.equal(io.callsOf('upload').length, 0); assert.match(text(io.tree), /still running/);
  gate.resolve(); await Promise.all([a, b, c]); await io.settle();
  await io.pick(io.control('supporting'), picked('support.doc')); assert.equal(io.callsOf('upload').length, 1);
});
test('actual job-card save retains new quote/supporting purposes and untouched legacy metadata', async t => {
  const io = fixture(t, { mode: 'card', files: [legacy] }); await io.start();
  await io.pick(io.control('supporting'), picked('support.doc')); await io.settle();
  await io.pick(io.control('quote'), picked('price.doc')); await io.settle();
  await button(io.tree, 'Save details').props.onClick(); await io.settle();
  assert.equal(io.callsOf('save').length, 1); assert.deepEqual(io.callsOf('save')[0].args.data.files.map(f => f.purpose), ['supporting', 'quote']);
  assert.deepEqual(io.persisted[0], legacy); assert.equal(core.quoteFileCount(io.persisted), 2);
  assert.equal(io.callsOf('refresh').length, 1);
});
