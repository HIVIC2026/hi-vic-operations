import { expect, mock, test } from 'bun:test';
const rows: { table: string; row: Record<string, unknown> }[] = [];
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table: string) => ({ insert: async (row: Record<string, unknown>) => { rows.push({ table, row }); return { error: null }; } }) } }));
let providerCalls = 0;
globalThis.fetch = (async () => { providerCalls++; throw new Error('provider calls forbidden'); }) as typeof fetch;
mock.module('../src/lib/twilio-au1.server', () => ({ au1SendMessage: async () => { providerCalls++; throw new Error('provider calls forbidden'); } }));
mock.module('../src/lib/qa-inbox.server', () => ({ qaDeliveryHeld: async () => false, qaInboxRouteForJob: async () => null }));
const { sendTestEmail, sendTestSms } = await import('../src/lib/test-send.server');
test('actual test sender rejects reserved contact before provider and records blocked_prelaunch locally', async () => {
  const context = { jobId: 'synthetic-job', jobSource: 'qa_test', partnerIsTest: true, label: 'isolated contact denial', actorId: null };
  expect((await sendTestEmail(context, 'owner@hivic-test.example', 'Synthetic', '<p>TEST</p>', 'TEST')).status).toBe('blocked');
  expect((await sendTestSms(context, '', 'TEST')).status).toBe('blocked');
  expect(providerCalls).toBe(0);
  const communications = rows.filter(r => r.table === 'job_communications');
  expect(communications.length).toBe(2);
  expect(communications.every(r => r.row.delivery_status === 'blocked_prelaunch')).toBe(true);
});