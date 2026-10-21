import { expect, mock, test } from 'bun:test';

let allowed = true;
let readinessCalls = 0;
const reads: string[] = [];
const consent = { consent_status: 'granted', consented_at: '2026-10-01T00:00:00Z' };
let readError = false;
mock.module('@tanstack/react-start', () => ({ createServerFn: () => {
  let validate = (data: unknown): unknown => data;
  const chain = { middleware: () => chain, inputValidator: (fn: typeof validate) => { validate = fn; return chain; },
    handler: (fn: (args: unknown) => unknown) => (args: { data: unknown; context: unknown }) => fn({ ...args, data: validate(args.data) }) };
  return chain;
} }));
mock.module('@/integrations/supabase/auth-middleware', () => ({ requireSupabaseAuth: {} }));
mock.module('../src/lib/workflow.server', () => ({ requireAdmin: async () => { if (!allowed) throw new Error('Admin only.'); }, requireJobRole: async () => 'admin' }));
mock.module('../src/lib/file-links.server', () => ({ signFile: () => { throw new Error('Consent must not sign files'); } }));
mock.module('../src/lib/esc.server', () => ({ installReadiness: async () => { readinessCalls++; return { ready: false, blockers: ['TEST hold'] }; } }));
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table: string) => {
  reads.push(table);
  const q = { select: () => q, eq: () => q, not: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: table === 'owner_contact_consents' ? [consent] : { status: 'pending', due_by: '2026-10-22' }, error: readError ? { message: 'TEST failure' } : null })) };
  return q;
} } }));
const { getJobContactConsent, getJobFileHeader } = await import('../src/lib/jobfile.functions');
const invoke = (fn: unknown, data: unknown) => (fn as (args: unknown) => Promise<any>)({ data, context: { supabase: {} } });
const jobId = '518271f4-90b5-4d16-8ccc-2d2a5a0a12c1';

test('identity reads the latest consent only, without intake/media/readiness work', async () => {
  reads.length = 0;
  expect(await invoke(getJobContactConsent, { jobId })).toEqual({ consent });
  expect(reads).toEqual(['owner_contact_consents']);
  expect(readinessCalls).toBe(0);
});
test('consent requires admin before any privileged read and surfaces read failures', async () => {
  allowed = false; reads.length = 0;
  await expect(invoke(getJobContactConsent, { jobId })).rejects.toThrow('Admin only.');
  expect(reads).toEqual([]);
  allowed = true; readError = true;
  await expect(invoke(getJobContactConsent, { jobId })).rejects.toThrow('Contact consent could not load');
  readError = false;
});
test('header skips hidden readiness but retains default/full readiness and ESC facts', async () => {
  const light = await invoke(getJobFileHeader, { jobId, includeReadiness: false });
  expect(light).toEqual({ escDueBy: '2026-10-22', escStatus: 'pending', ready: null });
  expect(readinessCalls).toBe(0);
  const full = await invoke(getJobFileHeader, { jobId });
  expect(full.ready).toEqual({ ready: false, blockers: ['TEST hold'] });
  expect(readinessCalls).toBe(1);
});