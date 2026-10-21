import { expect, mock, test } from 'bun:test';
let started = false;
let release: (() => void) | undefined;
const hydration = new Promise<void>(resolve => { release = resolve; });
mock.module('../src/lib/enquiry-groups.server', () => ({ loadEnquiryGroups: async () => {
  started = true;
  await hydration;
  return { rows: [{ id: 'TEST', status: 'needs_attention', mediaOutcome: null }] };
} }));
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: {
  rpc: async () => ({ data: { ids: ['TEST'], counts: {}, total: 1 }, error: null }),
  from: () => ({ select: () => ({ in: async () => {
    expect(started).toBe(true);
    release?.();
    return { data: [{ id: 'TEST', enquiry_status: 'needs_attention' }], error: null };
  } }) }),
} }));
const { loadOfficeEnquiryPage } = await import('../src/lib/office-enquiry-page.server');
test('index facts start before hydration settles without changing returned page facts', async () => {
  const result = await loadOfficeEnquiryPage('new', '', 1);
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]?.id).toBe('TEST');
  expect(result.total).toBe(1);
});