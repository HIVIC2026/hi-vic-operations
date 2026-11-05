import { expect, mock, test } from 'bun:test';
let databaseReads = 0;
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: () => { databaseReads++; throw new Error('No records may be read while wording is unapproved'); } } }));
const { notifyInstallerQuoteSent } = await import('../src/lib/installer-quote-sent.server');
test('unapproved installer quote-sent email performs no reads or delivery, including TEST', async () => {
  expect(await notifyInstallerQuoteSent('test-job', 'test-quote')).toBe('awaiting wording approval');
  expect(databaseReads).toBe(0);
});