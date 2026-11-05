import { expect, mock, test } from 'bun:test';

const released: string[] = [];
const draft = { id: 'quote-a1', status: 'draft', sent_at: null, option_code: 'INSTALLER_A1' };
function query(table: string) {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) q[method] = () => q;
  q.maybeSingle = async () => ({ data: { channel: 'installer_sourced' }, error: null });
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === 'quotes' ? [draft] : [], error: null }).then(resolve);
  return q;
}
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: query } }));
mock.module('../src/lib/workflow.server', () => ({ logEvent: async () => {} }));
mock.module('../src/lib/installer-quote.server', () => ({ INSTALLER_QUOTE_CODE: 'INSTALLER_A1' }));
mock.module('../src/lib/office-quote-review.server', () => ({
  officeQuoteBlockers: async () => [],
  releaseQuoteToOwner: async () => { released.push('sent'); },
}));
const { maybeAutoSendInstallerQuote } = await import('../src/lib/auto-quote-send.server');
test('own customer draft cannot automatically send even when caller enables sending and all checks pass', async () => {
  const result = await maybeAutoSendInstallerQuote('own-job', { enabled: true, formCompleted: true, formModifiedAt: null });
  expect(result.sent).toBe(false);
  expect(released).toHaveLength(0);
  expect(draft.status).toBe('draft');
});