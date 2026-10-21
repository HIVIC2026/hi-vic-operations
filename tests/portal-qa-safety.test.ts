import { expect, test } from 'bun:test';
import { qaWorkflowFixtureBlocker, readyCheckWindowProofBlocker, readyCheckFreeProofBlocker, readyCheckScheduledProofBlocker, type WindowProof } from '../scripts/portal-qa-safety';
import { allowedPiesaDays, windowBounds } from '../src/lib/piesa-windows.core';
const fixture = { source: 'qa_test', ownerEmail: 'synthetic@hivic-test.example', ownerPhone: null, businessId: 'test-business', relatedBusinessId: 'test-business', businessNotes: '[TEST PARTNER]' };
test('both real allowlisted inboxes and real phone are rejected for workflow QA', () => {
  for (const ownerEmail of ['jolowexo@hotmail.com', 'jo@actpropertyinspections.com.au']) expect(qaWorkflowFixtureBlocker({ ...fixture, ownerEmail })).not.toBeNull();
  expect(qaWorkflowFixtureBlocker({ ...fixture, ownerPhone: '0477511901' })).not.toBeNull();
  expect(qaWorkflowFixtureBlocker(fixture)).toBeNull();
});
test('reserved email alone cannot replace TEST source and related marked business', () => {
  for (const patch of [{ source: 'base44' }, { businessNotes: null }, { relatedBusinessId: 'other' }, { ownerEmail: 'synthetic@hivic-test.example.evil.test' }]) expect(qaWorkflowFixtureBlocker({ ...fixture, ...patch })).not.toBeNull();
});
const now = new Date('2026-10-21T02:34:00Z');
function proof(count = 3): WindowProof {
  const days = allowedPiesaDays(now);
  const picks = days.slice(0, count).map(date => ({ date, slot: '10-12' as const }));
  return { picks, saved: picks.map(w => ({ ...windowBounds(w.date, w.slot), status: 'open', round: 1 })), round: 1, checkedJobId: 'test-job', expectedJobId: 'test-job', events: [], readsOk: true, paymentRows: 0, invoiceRows: 0, providerSends: 0 };
}
test('exact three through five persisted allowed windows pass; fewer or more fail', () => {
  for (const n of [3, 4, 5]) expect(readyCheckWindowProofBlocker(proof(n), now)).toBeNull();
  for (const n of [2, 6]) expect(readyCheckWindowProofBlocker(proof(n), now)).not.toBeNull();
});
test('three days must be Melbourne allowed business days, not three windows on one day', () => {
  const p = proof();
  p.picks = ['8-10', '10-12', '12-14'].map(slot => ({ date: p.picks[0]?.date ?? '', slot: slot as '8-10' | '10-12' | '12-14' }));
  expect(readyCheckWindowProofBlocker(p, now)).not.toBeNull();
  const holiday = proof(); holiday.picks[0] = { date: '2026-11-03', slot: '10-12' };
  expect(readyCheckWindowProofBlocker(holiday, now)).not.toBeNull();
});
test('accepted UI cannot conceal missing/stale/wrong-job windows or failed reads', () => {
  for (const patch of [{ saved: [] }, { readsOk: false }, { checkedJobId: 'other' }, { round: 2 }]) expect(readyCheckWindowProofBlocker({ ...proof(), ...patch }, now)).not.toBeNull();
});
test('failure events and payment/invoice/provider effects fail even with valid saved windows', () => {
  for (const event of ['ready_check_windows_not_saved', 'advance_blocked']) expect(readyCheckWindowProofBlocker({ ...proof(), events: [event] }, now)).not.toBeNull();
  for (const patch of [{ paymentRows: 1 }, { invoiceRows: 1 }, { providerSends: 1 }]) expect(readyCheckWindowProofBlocker({ ...proof(), ...patch }, now)).not.toBeNull();
});
test('persisted Z, +00:00 and fractional timestamp formats identify the same allowed windows; invalid timestamps fail', () => {
  const p = proof();
  p.saved = p.saved.map((w, i) => ({ ...w, starts_at: i === 0 ? w.starts_at.replace('.000Z', 'Z') : i === 1 ? w.starts_at.replace('.000Z', '+00:00') : w.starts_at.replace('.000Z', '.000000+00:00'), ends_at: w.ends_at?.replace('.000Z', '.000000+00:00') ?? null }));
  expect(readyCheckWindowProofBlocker(p, now)).toBeNull();
  for (const starts_at of ['invalid', '2026-02-30T10:00:00Z', '2026-13-23T10:00:00Z', '2026-10-23T10:00:00', '']) {
    expect(readyCheckWindowProofBlocker({ ...p, saved: p.saved.map((w, i) => i === 0 ? { ...w, starts_at } : w) }, now)).not.toBeNull();
  }
});
test('FREE proof requires actual acceptance amount 0 and paymentId null, not a verified flag', () => {
  const p = { readsOk: true, expectedJobId: 'test-job', acceptance: { job_id: 'test-job', ready_check_amount_inc_gst: 0 }, paymentState: { paymentId: null } };
  expect(readyCheckFreeProofBlocker(p)).toBeNull();
  expect(readyCheckFreeProofBlocker({ ...p, acceptance: null })).not.toBeNull();
  expect(readyCheckFreeProofBlocker({ ...p, acceptance: { ...p.acceptance, ready_check_amount_inc_gst: 349 } })).not.toBeNull();
  expect(readyCheckFreeProofBlocker({ ...p, paymentState: { paymentId: 'payment' } })).not.toBeNull();
  expect(readyCheckFreeProofBlocker({ ...p, readsOk: false })).not.toBeNull();
});
test('owner OPEN-window request is not installer-confirmed booking; taken window must match actual confirmed booking', () => {
  const w = proof().saved[0]; if (!w) throw new Error('missing window');
  const p = { readsOk: true, expectedJobId: 'test-job', job: { id: 'test-job', stage: 'ready_check_scheduled' }, selected: { ...w, job_id: 'test-job', status: 'taken' }, booking: { scheduled_start: w.starts_at, scheduled_end: null, job_id: 'test-job', kind: 'ready_check', status: 'confirmed' } };
  expect(readyCheckScheduledProofBlocker(p)).toBeNull();
  expect(readyCheckScheduledProofBlocker({ ...p, selected: { ...p.selected, status: 'open' } })).not.toBeNull();
  expect(readyCheckScheduledProofBlocker({ ...p, job: { ...p.job, stage: 'ready_check_ready_to_schedule' } })).not.toBeNull();
  expect(readyCheckScheduledProofBlocker({ ...p, booking: null })).not.toBeNull();
  expect(readyCheckScheduledProofBlocker({ ...p, booking: { ...p.booking, scheduled_start: 'invalid' } })).not.toBeNull();
});