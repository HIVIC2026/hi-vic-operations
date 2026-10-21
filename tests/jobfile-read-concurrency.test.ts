import { expect, mock, test } from 'bun:test';
const calls: { table: string; columns: string }[] = [];
let release: () => void = () => {};
const pending = new Promise<void>(resolve => { release = resolve; });
mock.module('../src/lib/workflow.server', () => ({ logEvent: async () => {} }));
mock.module('../src/lib/file-links.server', () => ({ signFile: async () => ({}) }));
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table: string) => {
  let columns = '';
  const q = { select: (c: string) => { columns = c; return q; }, eq: () => q, in: () => q, single: () => q,
    then: async (resolve: (value: unknown) => unknown) => {
      calls.push({ table, columns });
      if (table === 'documents') await pending;
      const data = table === 'jobs' ? { owners: { user_id: 'OWNER' }, created_at: '2026-10-01', stage: 'new_enquiry', updated_at: '2026-10-01' } : table === 'documents' ? [{ id: 'FILE', kind: 'piesa_certificate', title: 'Safety', storage_path: 'TEST/FILE.pdf', created_at: '2026-10-01', created_by: 'OWNER' }] : table === 'workflow_events' ? [{ id: 'EVENT', event_type: 'test', actor_id: 'OWNER', created_at: '2026-10-01', payload: { private: 'detail' } }] : table === 'profiles' ? [{ id: 'OWNER', full_name: 'TEST Owner' }] : [];
      return resolve({ data, error: null });
    } };
  return q;
} } }));
const { buildJobFile } = await import('../src/lib/jobfile.server');
test('combined job metadata starts before source completion; role output still masks private paths/details', async () => {
  const loading = buildJobFile('TEST', 'installer');
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(calls.filter(c => c.table === 'jobs')).toEqual([{ table: 'jobs', columns: 'owners(user_id), created_at, stage, updated_at' }]);
  release();
  const result = await loading;
  expect(result.documents[0]?.storagePath).toBe('private');
  expect(result.timeline.every(t => t.detail === null)).toBe(true);
  expect(result.retention).toBeNull();
  expect(['profiles','user_roles','job_assignments'].every(t => calls.some(c => c.table === t))).toBe(true);
});