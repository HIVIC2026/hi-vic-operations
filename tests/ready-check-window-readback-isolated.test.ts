// Actual persistence module; all persistence, workflow and dispatch are sealed in memory.
import { expect, mock, test } from 'bun:test';
import { allowedPiesaDays } from '../src/lib/piesa-windows.core';
import { readyCheckWindowProofBlocker } from '../scripts/portal-qa-safety';
type Row = Record<string, unknown>;
let windows: Row[] = [], events: string[] = [], failInsert = false, providerCalls = 0;
let acceptance: Row | null = null, acceptanceInserts = 0, activeInstaller = false, failRead = false;
const token = 'a'.repeat(64);
const touchedTables: string[] = [];
const jobId = 'isolated-qa-job';
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: { from: (table: string) => {
  touchedTables.push(table);
  if (!['jobs', 'job_assignments', 'ready_check_windows', 'workflow_events', 'customer_estimate_links', 'indicative_estimates', 'ready_check_acceptances'].includes(table)) throw new Error(`unexpected persistence boundary: ${table}`);
  let payload: Row[] | null = null;
  const result = () => {
    if (table === 'ready_check_windows' && payload) {
      if (failInsert) return { data: null, error: { message: 'isolated insertion failure' } };
      windows.push(...payload.map(p => ({ ...p, status: 'open', created_at: '2026-10-21T02:34:00Z' })));
    }
    if (table === 'ready_check_acceptances' && payload) {
      if (acceptance) return { data: null, error: { code: '23505', message: 'duplicate acceptance' } };
      acceptanceInserts++; acceptance = { ...payload[0], id: 'accepted-once', accepted_at: new Date().toISOString() };
    }
    const data = table === 'ready_check_windows' ? windows : table === 'jobs' ? { stage: 'ready_check_awaiting_acceptance' }
      : table === 'ready_check_acceptances' ? acceptance
      : table === 'customer_estimate_links' ? { id: 'link', job_id: jobId, status: 'active', expires_at: '2099-01-01T00:00:00Z', current_estimate_id: 'estimate', view_count: 1 }
      : table === 'indicative_estimates' ? { id: 'estimate', job_id: jobId, status: 'current', input_signature: 'sig', settings_version: 1, applied_discount: 200, scenarios: [{ key: 'can_remain', by_access: { standard: { estimated_customer_total: 4300 } } }] } : [];
    return { data, count: table === 'job_assignments' && activeInstaller ? 1 : 0, error: table === 'ready_check_windows' && failRead ? { message: 'window read failed' } : null };
  };
  const chain = { select: () => chain, eq: () => chain, order: () => chain, limit: () => chain, update: () => chain, insert: (rows: Row[] | Row) => { payload = Array.isArray(rows) ? rows : [rows]; return chain; }, single: async () => result(), maybeSingle: async () => result(), then: (resolve: (r: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
  return chain;
} } }));
mock.module('../src/lib/workflow.server', () => ({ WorkflowError: Error, getStage: async () => 'ready_check_ready_to_schedule', transition: async () => {}, logEvent: async (_j: string, _a: unknown, event: string) => { events.push(event); } }));
mock.module('../src/lib/installer-ready-check.server', () => ({ ownerTimesRequested: async () => false }));
mock.module('../src/lib/visit-events.server', () => ({ timesReopenedSince: async () => false }));
mock.module('../src/lib/offer-dispatch.server', () => ({ jobOfficePicks: async () => true }));
globalThis.fetch = (async () => { providerCalls++; throw new Error('network forbidden'); }) as typeof fetch;
const { submitReadyCheckWindows } = await import('../src/lib/readycheck-booking.server');
const { acceptReadyCheck, readyCheckAcceptanceState } = await import('../src/lib/readycheck-payment.server');
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

function resetRequest() {
  windows = []; events = []; acceptance = null; acceptanceInserts = 0;
  failInsert = false; activeInstaller = false; failRead = false;
  return allowedPiesaDays(new Date()).slice(0, 3).map(date => ({ date, slot: '10-12' as const }));
}
test('actual acceptance surfaces active-installer gate, retains acceptance and hides success after refresh', async () => {
  const picks = resetRequest(); activeInstaller = true;
  await expect(acceptReadyCheck(token, {}, picks)).rejects.toThrow('An installer is already arranging your Ready Check.');
  expect(acceptanceInserts).toBe(1); expect(windows).toEqual([]);
  expect(events).toEqual(['ready_check_windows_not_saved']);
  expect(await readyCheckAcceptanceState(token)).toBeNull();
});
test('stored acceptance with failed windows retries safely without erasing history or inserting acceptance again', async () => {
  const picks = resetRequest(); failInsert = true;
  await expect(acceptReadyCheck(token, {}, picks)).rejects.toThrow('isolated insertion failure');
  const before = structuredClone(acceptance); failInsert = false;
  const result = await acceptReadyCheck(token, {}, picks);
  expect(result.amountIncGst).toBe(0); expect(result.paymentId).toBeNull();
  expect(acceptance).toEqual(before); expect(acceptanceInserts).toBe(1); expect(windows).toHaveLength(3);
  expect(events).toEqual(['ready_check_windows_not_saved', 'ready_check_windows_chosen']);
});
test('first and identical duplicate requests return success only with exact persisted times and one acceptance', async () => {
  const picks = resetRequest();
  const first = await acceptReadyCheck(token, {}, picks);
  const saved = structuredClone(windows);
  expect(await acceptReadyCheck(token, {}, picks)).toEqual(first);
  expect(windows).toEqual(saved); expect(acceptanceInserts).toBe(1);
  expect(events).toEqual(['ready_check_windows_chosen']);
  expect((await readyCheckAcceptanceState(token))?.paymentId).toBeNull();
  expect(acceptance?.ready_check_amount_inc_gst).toBe(0); expect(providerCalls).toBe(0);
});
test('persisted different times cannot turn a rejected request into success', async () => {
  const picks = resetRequest(); await acceptReadyCheck(token, {}, picks);
  await expect(acceptReadyCheck(token, {}, picks.map(p => ({ ...p, slot: '12-14' as const })))).rejects.toThrow('Your Ready Check times are already with our installers.');
  expect(acceptanceInserts).toBe(1); expect(windows).toHaveLength(3);
});
test('window read errors fail closed rather than claiming success or replacing acceptance', async () => {
  const picks = resetRequest(); await acceptReadyCheck(token, {}, picks); failRead = true;
  await expect(acceptReadyCheck(token, {}, picks)).rejects.toThrow('window read failed');
  await expect(readyCheckAcceptanceState(token)).rejects.toThrow('window read failed');
  expect(acceptanceInserts).toBe(1);
});