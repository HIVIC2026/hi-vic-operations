// Actual persistence module; all persistence, workflow and dispatch are sealed in memory.
import { expect, mock, test } from 'bun:test';
import { allowedPiesaDays } from '../src/lib/piesa-windows.core';
import { readyCheckWindowProofBlocker } from '../scripts/portal-qa-safety';
type Row = Record<string, unknown>;
let windows: Row[] = [], events: string[] = [], failInsert = false, providerCalls = 0;
const touchedTables: string[] = [];
const jobId = 'isolated-qa-job';
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table: string) => {
  touchedTables.push(table);
  if (!['jobs', 'job_assignments', 'ready_check_windows', 'workflow_events'].includes(table)) throw new Error(`unexpected persistence boundary: ${table}`);
  let payload: Row[] | null = null;
  const result = () => {
    if (table === 'ready_check_windows' && payload) {
      if (failInsert) return { data: null, error: { message: 'isolated insertion failure' } };
      windows.push(...payload.map(p => ({ ...p, status: 'open', created_at: '2026-10-21T02:34:00Z' })));
    }
    return { data: table === 'ready_check_windows' ? windows : table === 'jobs' ? { stage: 'ready_check_awaiting_acceptance' } : [], count: 0, error: null };
  };
  const chain = { select: () => chain, eq: () => chain, update: () => chain, insert: (rows: Row[]) => { payload = rows; return chain; }, single: async () => result(), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
  return chain;
} } }));
mock.module('../src/lib/workflow.server', () => ({ WorkflowError: Error, logEvent: async (_j: string, _a: unknown, event: string) => { events.push(event); } }));
mock.module('../src/lib/visit-events.server', () => ({ timesReopenedSince: async () => false }));
mock.module('../src/lib/offer-dispatch.server', () => ({ jobOfficePicks: async () => true }));
globalThis.fetch = (async () => { providerCalls++; throw new Error('network forbidden'); }) as typeof fetch;
const { submitReadyCheckWindows } = await import('../src/lib/readycheck-booking.server');
const now = new Date('2026-10-21T02:34:00Z');
for (const count of [3, 4, 5]) test(`actual submit saves and reads back ${count} allowed windows; isolated only`, async () => {
  windows = []; events = []; failInsert = false; touchedTables.length = 0;
  const picks = allowedPiesaDays(now).slice(0, count).map(date => ({ date, slot: '10-12' as const }));
  const result = await submitReadyCheckWindows(jobId, picks, now);
  expect(result).toEqual({ ok: true, round: 1 });
  expect(events).toEqual(['ready_check_windows_chosen']);
  const saved = windows.map(w => ({ starts_at: String(w.starts_at), ends_at: String(w.ends_at), round: Number(w.round), status: String(w.status) }));
  expect(readyCheckWindowProofBlocker({ picks, saved, round: result.round, checkedJobId: jobId, expectedJobId: jobId, readsOk: true, events, paymentRows: 0, invoiceRows: 0, providerSends: providerCalls }, now)).toBeNull();
  expect(providerCalls).toBe(0);
  expect(touchedTables.some(t => /payment|invoice|communication|outbound/.test(t))).toBe(false);
});
test('failed actual window insertion rejects, persists nothing and cannot be a booking PASS', async () => {
  windows = []; events = []; failInsert = true;
  const picks = allowedPiesaDays(now).slice(0, 3).map(date => ({ date, slot: '10-12' as const }));
  await expect(submitReadyCheckWindows(jobId, picks, now)).rejects.toThrow('isolated insertion failure');
  expect(windows).toEqual([]);
  expect(events).toEqual([]);
  expect(providerCalls).toBe(0);
});