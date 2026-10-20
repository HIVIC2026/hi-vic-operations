// Actual source functions with only database, framework, provider and auth boundaries substituted.
// Run: node tests/readiness-errors.test.mjs (TypeScript must be installed in the repository).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const dependencyRoot = process.env.HIVIC_READINESS_TEST_DEPS_ROOT;
const require = dependencyRoot ? createRequire(resolve(dependencyRoot, 'package.json')) : createRequire(import.meta.url);
const ts = require('typescript');
const root = new URL('../', import.meta.url);
class WorkflowError extends Error {}
const chain = () => ({ middleware() { return this; }, inputValidator() { return this; }, handler(fn) { return fn; } });
const z = new Proxy(function () {}, { get: (_, key) => key === 'parse' ? value => value : z, apply: () => z });

function actual(file, names, deps = {}) {
  const text = readFileSync(new URL(file, root), 'utf8');
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = new Set();
  const source = parsed.statements.filter(statement => {
    const ids = ts.isFunctionDeclaration(statement) && statement.name ? [statement.name.text]
      : ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(d => d.name.getText(parsed)) : [];
    for (const id of ids) if (names.includes(id)) found.add(id);
    return ids.some(id => names.includes(id));
  }).map(statement => statement.getText(parsed)).join('\n');
  for (const name of names) assert.ok(found.has(name), `Actual source export missing: ${file}:${name}`);
  const adapted = source.replaceAll(/\bimport\("([^"]+)"\)/g, 'deps.load("$1")');
  const js = ts.transpileModule(adapted, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replaceAll(/^export /gm, '');
  const values = { WorkflowError, createServerFn: chain, z, requireSupabaseAuth: {}, requireAdmin: async () => {}, uuid: z, txt: () => z, ...deps };
  return new Function('deps', ...Object.keys(values), js + '\nreturn {' + names.join(',') + '};')(values, ...Object.values(values));
}

function database(override = () => undefined) {
  const queries = [], writes = [];
  const settings = { id: 'settings', measurement_standard_approved: false, measurement_standard_version: null };
  const db = {
    rpc: async name => override({ table: '$rpc', name, op: 'read' }) ?? { data: true, error: null },
    from(table) {
      const q = { table, op: 'select', filters: [], single: false, columns: '*' };
      const builder = {
        select(columns) { q.columns = columns; return this; },
        update(patch) { q.op = 'update'; q.patch = patch; return this; },
        insert(patch) { q.op = 'insert'; q.patch = patch; return this; },
        eq(key, value) { q.filters.push([key, value]); return this; },
        order() { return this; }, limit() { return this; }, or() { return this; },
        single() { q.single = true; return this; }, maybeSingle() { q.single = true; return this; },
        then(yes, no) {
          queries.push(q);
          if (q.op !== 'select') writes.push(q);
          let result = override(q);
          if (result === undefined) {
            if (q.op === 'update' && table === 'workflow_settings') { Object.assign(settings, q.patch); result = { data: { id: settings.id }, error: null }; }
            else if (table === 'workflow_settings') result = { data: { ...settings }, error: null };
            else if (table === 'profiles') result = { data: { business_id: 'business' }, error: null };
            else if (table === 'business_members') result = { data: [{ business_id: 'business', member_role: 'business_admin' }], error: null };
            else if (table === 'businesses' && q.single) result = { data: { id: 'business', name: 'TEST business', onboarding_status: 'approved' }, error: null };
            else if (table === 'esc_notification_config') result = { data: null, count: 0, error: null };
            else result = { data: q.single ? null : [], error: null };
          }
          return Promise.resolve(result).then(yes, no);
        },
      };
      return builder;
    },
  };
  return { db, queries, writes, settings };
}
const context = db => ({ userId: 'office-user', supabase: db });
const failed = message => ({ data: null, error: { message } });

function pilot(db) {
  const helpers = actual('src/lib/pilot.server.ts', ['loadBusiness', 'myBusinesses'], { admin: db });
  return actual('src/lib/pilot.functions.ts', ['isAdmin', 'getPartnerProfile', 'getMeasurementStandard', 'setMeasurementStandard'], {
    admin: db, ...helpers, onboardingChecklist: () => [],
  });
}

test('compliance database failure propagates instead of becoming no templates', async () => {
  const { db } = database(q => q.table === 'compliance_templates' ? failed('unavailable') : undefined);
  const { loadTemplates } = actual('src/lib/assignment.server.ts', ['loadTemplates'], { admin: db });
  await assert.rejects(loadTemplates(), /Could not read compliance template approvals/);
  const { listComplianceTemplates } = actual('src/lib/portal.functions.ts', ['listComplianceTemplates'], { admin: db });
  await assert.rejects(listComplianceTemplates({ context: context(db) }), /Could not read compliance versions/);
});

test('empty successful compliance read remains a legitimate empty list', async () => {
  const { db } = database();
  const { loadTemplates } = actual('src/lib/assignment.server.ts', ['loadTemplates'], { admin: db });
  assert.deepEqual(await loadTemplates(), []);
});

test('readiness rejects failed or missing exact approval counts', async () => {
  for (const result of [{ data: null, count: null, error: null }, { ...failed('count failed'), count: null }]) {
    const { db } = database(q => q.table === 'esc_notification_config' ? result : undefined);
    const { getComplianceSetup } = actual('src/lib/portal.functions.ts', ['getComplianceSetup'], { admin: db, loadTemplates: async () => [], setupStatus: () => { throw new Error('must not report readiness'); } });
    await assert.rejects(getComplianceSetup({ context: context(db) }), /Could not read ESC notification approval/);
  }
});

test('AP standard read failure and missing settings do not become an unapproved default', async () => {
  for (const result of [failed('read failed'), { data: null, error: null }]) {
    const { db } = database(q => q.table === 'workflow_settings' ? result : undefined);
    await assert.rejects(pilot(db).getMeasurementStandard({ context: context(db) }), /Could not read the AP measurement standard/);
  }
});

for (const [table, expected] of [['partner_measurement_methods', /measurement methods/], ['partner_agreements', /partner agreements/], ['business_credentials', /business credentials/], ['business_members', /active business memberships/]]) {
  test(`business profile exposes ${table} failure`, async () => {
    const { db, writes } = database(q => q.table === table ? failed('read failed') : undefined);
    await assert.rejects(pilot(db).getPartnerProfile({ data: { businessId: 'business' }, context: context(db) }), expected);
    assert.equal(writes.length, 0);
  });
}

test('unreadable Office authorization stops before business reads', async () => {
  const { db, queries } = database(q => q.table === '$rpc' ? failed('access check failed') : undefined);
  await assert.rejects(pilot(db).getPartnerProfile({ data: { businessId: 'business' }, context: context(db) }), /Could not check Office access/);
  assert.equal(queries.length, 0);
});

test('successful business read returns real empty methods without writes', async () => {
  const { db, writes } = database();
  const result = await pilot(db).getPartnerProfile({ data: { businessId: 'business' }, context: context(db) });
  assert.deepEqual(result.measurementMethods, []);
  assert.equal(result.business.id, 'business');
  assert.equal(writes.length, 0);
});

const standardInput = { version: 'TEST-1', approved: true, tolerancePct: null, reason: 'Isolated test only' };
test('failed and zero-row AP saves never record a completed approval audit', async () => {
  for (const result of [failed('write failed'), { data: null, error: null }, { data: { id: 'different' }, error: null }]) {
    const { db, writes, settings } = database(q => q.table === 'workflow_settings' && q.op === 'update' ? result : undefined);
    await assert.rejects(pilot(db).setMeasurementStandard({ data: standardInput, context: context(db) }), /not confirmed saved/);
    assert.equal(writes.filter(q => q.table === 'admin_config_events').length, 0);
    assert.equal(settings.measurement_standard_approved, false);
  }
});

test('audit failure after an actual AP setting save reports that partial outcome', async () => {
  const { db, settings } = database(q => q.table === 'admin_config_events' ? failed('audit unavailable') : undefined);
  await assert.rejects(pilot(db).setMeasurementStandard({ data: standardInput, context: context(db) }), /was saved, but its audit record failed/);
  assert.equal(settings.measurement_standard_approved, true);
  assert.equal(settings.measurement_standard_version, 'TEST-1');
});

test('successful explicit AP save requires one changed settings row and audit', async () => {
  const { db, writes, settings } = database();
  assert.deepEqual(await pilot(db).setMeasurementStandard({ data: standardInput, context: context(db) }), { ok: true });
  assert.equal(settings.measurement_standard_approved, true);
  assert.deepEqual(writes.map(q => q.table), ['workflow_settings', 'admin_config_events']);
});

const routing = actual('src/lib/xero.core.ts', ['XERO_LIVE_CALLS_ENABLED', 'DEMO', 'LIVE', 'describeXeroRouting', 'pickXeroTenant']);
function xero(env, result) {
  const calls = [];
  const fn = actual('src/lib/xero.server.ts', ['GATEWAY', 'creds', 'rawFetch', 'xeroConnectionStatus'], {
    describeXeroRouting: routing.describeXeroRouting, process: { env }, XERO_FETCH_TIMEOUT_MS: 500,
    timeoutSignal: () => undefined,
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => result }; },
  }).xeroConnectionStatus;
  return { fn, calls };
}

test('missing Xero credentials produce unchecked routes without contacting a provider', async () => {
  const { fn, calls } = xero({}, []);
  const result = await fn();
  assert.equal(result.configured, false);
  assert.equal(result.connected, false);
  assert.equal(calls.length, 0);
});

test('Xero health reads connections only and distinguishes available live books from disabled routing', async () => {
  const { fn, calls } = xero({ LOVABLE_API_KEY: 'isolated-test', XERO_API_KEY: 'isolated-test' }, [{ tenantId: 'demo', tenantName: 'Demo Company (AU)' }, { tenantId: 'real', tenantName: 'DC Construction Solutions' }]);
  const result = await fn();
  assert.equal(result.connected, true);
  assert.equal(result.routing.testOrganisation, 'Demo Company (AU)');
  assert.deepEqual(result.routing.liveCandidates, ['DC Construction Solutions']);
  assert.equal(result.routing.liveCallsEnabled, false);
  assert.equal(result.routing.liveOrganisation, null);
  assert.match(result.routing.liveBlocker, /switched off/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://connector-gateway.lovable.dev/xero/connections');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.body, undefined);
});

test('empty and malformed Xero organisation responses never report a usable connection', async () => {
  const env = { LOVABLE_API_KEY: 'isolated-test', XERO_API_KEY: 'isolated-test' };
  assert.equal((await xero(env, []).fn()).connected, false);
  for (const result of [{ organisations: [] }, [{ tenantId: 4 }], [{ tenantId: 'x', tenantName: { secret: 'not a name' } }]])
    await assert.rejects(xero(env, result).fn(), /unreadable organisation list/);
});
