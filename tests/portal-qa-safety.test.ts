import { expect, test } from 'bun:test';
import { qaWorkflowFixtureBlocker, readyCheckWindowProofBlocker, type WindowProof } from '../scripts/portal-qa-safety';
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
  return { picks, saved: picks.map(w => ({ ...windowBounds(w.date, w.slot), status: 'available', purpose: 'ready_check', round: 1 })), round: 1, checkedJobId: 'test-job', expectedJobId: 'test-job', events: [], readsOk: true, paymentRows: 0, invoiceRows: 0, providerSends: 0 };
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