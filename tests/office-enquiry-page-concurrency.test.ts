import { expect, mock, test } from 'bun:test';

let factsStarted = false;
let failFacts = false;
mock.module('../src/lib/enquiry-groups.server', () => ({ loadEnquiryGroups: async () => {
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(factsStarted).toBe(true);
  return { rows: [{ id: 'test-id', status: 'new', nextAction: 'Existing action' }] };
} }));
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: {
  rpc: async () => ({ data: { ids: ['test-id'], page: 1 }, error: null }),
  from: () => ({ select: (_fields: string, options?: { head?: boolean }) => options?.head ? {
    eq() { return this; }, or() { return this; }, then(resolve: (v: unknown) => unknown) { return Promise.resolve(resolve({ count: 0, error: null })); },
  } : ({ in: () => ({ then: (resolve: (v: unknown) => unknown) => {
    factsStarted = true;
    return Promise.resolve(resolve({ data: [{ id: 'test-id' }], error: failFacts ? { message: 'TEST denied' } : null }));
  } }) }) }),
} }));
const { loadOfficeEnquiryPage } = await import('../src/lib/office-enquiry-page.server');
test('page detail and facts reads start together without swallowing facts errors', async () => {
  await loadOfficeEnquiryPage('all', '', 1);
  failFacts = true; factsStarted = false;
  await expect(loadOfficeEnquiryPage('all', '', 1)).rejects.toThrow('Could not verify enquiry page facts.');
});