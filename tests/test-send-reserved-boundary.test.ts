import { expect, mock, test } from 'bun:test';
const rows: { table: string; row: Record<string, unknown> }[] = [];
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table: string) => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'jobs' ? { source: 'qa_test' } : null, error: null }), insert: async (row: Record<string, unknown>) => { rows.push({ table, row }); return { error: null }; } };
  return q;
} } }));
let providerCalls = 0;
globalThis.fetch = (async () => { providerCalls++; throw new Error('provider calls forbidden'); }) as typeof fetch;
mock.module('../src/lib/twilio-au1.server', () => ({ au1SendMessage: async () => { providerCalls++; throw new Error('provider calls forbidden'); } }));
const { sendTestEmail, sendTestSms } = await import('../src/lib/test-send.server');
test('actual TEST sender holds mail while master is off and stops SMS before either provider', async () => {
  const context = { jobId: 'synthetic-job', jobSource: 'qa_test', partnerIsTest: true, label: 'isolated contact denial', actorId: null };
  expect((await sendTestEmail(context, 'owner@hivic-test.example', 'Synthetic', '<p>TEST</p>', 'TEST')).status).toBe('blocked');
  expect((await sendTestSms(context, '', 'TEST')).status).toBe('blocked');
  expect(providerCalls).toBe(0);
  const communications = rows.filter(r => r.table === 'job_communications');
  expect(communications.length).toBe(2);
  expect(communications.every(r => r.row.delivery_status === 'blocked_prelaunch')).toBe(true);
  expect(communications[0]?.row.recipients).toEqual(['jolowexo@hotmail.com']);
  expect(communications[0]?.row.body).toBe('TEST — would have gone to: owner@hivic-test.example\n\nTEST');
});