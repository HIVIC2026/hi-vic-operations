import { expect, mock, test } from 'bun:test';
let invalidations = 0;
mock.module('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: async () => { invalidations++; } }), useQuery: () => ({}) }));
mock.module('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }));
mock.module('sonner', () => ({ toast: { success: () => {}, error: () => {} } }));
mock.module('@/integrations/supabase/client', () => ({ supabase: {} }));
mock.module('../src/lib/jobfile.functions', () => ({ getJobFile: async () => ({}), openJobDocument: async () => ({ url: 'private' }), getJobFileHeader: async () => ({}), exportJobPackFn: async () => ({}), logCommunication: async () => ({}) }));
mock.module('../src/lib/nextstep.core', () => ({ nextStep: () => ({ next: '' }) }));
mock.module('../src/lib/workflow', () => ({ fmtDate: () => '' }));
mock.module('../src/components/portal/panels', () => ({ Section: () => null }));
mock.module('../src/components/portal/badges', () => ({ Pill: () => null }));
mock.module('../src/components/portal/file-viewer', () => ({ openFileViewer: () => {} }));
const { useAction } = await import('../src/hooks/use-me');
test('read-only document action does not refresh unrelated panels; ordinary writes still do', async () => {
  const fn = async () => ({ ok: true });
  expect(await useAction(fn, { refresh: false })({})).toEqual({ ok: true });
  expect(invalidations).toBe(0);
  await useAction(fn)({});
  expect(invalidations).toBe(1);
});
test('failed reads do not invalidate and do not report success', async () => {
  expect(await useAction(async () => { throw new Error('TEST refusal'); }, { refresh: false })({})).toBeUndefined();
  expect(invalidations).toBe(1);
});