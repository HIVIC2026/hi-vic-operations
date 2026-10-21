// QA evidence only: never reads/writes fixtures or invokes providers.
import { isTestPartner, testSendBlocker } from '../src/lib/test-send.core';
import { piesaWindowBlockers, windowBounds, type PiesaWindowPick } from '../src/lib/piesa-windows.core';

export type QaContactFixture = {
  source: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  businessId: string | null;
  relatedBusinessId: string | null;
  businessNotes: string | null;
};
export function qaWorkflowFixtureBlocker(f: QaContactFixture): string | null {
  if (f.source !== 'qa_test') return 'job source is not qa_test';
  if (!f.businessId || f.businessId !== f.relatedBusinessId || !isTestPartner({ onboarding_notes: f.businessNotes })) return 'related marked TEST business not verified';
  if (!f.ownerEmail || !/^[^@\s]+@(?:[a-z0-9-]+\.)*hivic-test\.example$/i.test(f.ownerEmail.trim())) return 'reserved TEST owner email required';
  if (!testSendBlocker({ channel: 'email', to: f.ownerEmail, jobSource: f.source, partnerIsTest: true })) return 'owner email could reach a test provider';
  if (f.ownerPhone && !testSendBlocker({ channel: 'sms', to: f.ownerPhone, jobSource: f.source, partnerIsTest: true })) return 'owner phone could reach a test provider';
  return null;
}

export type WindowProof = {
  picks: PiesaWindowPick[];
  saved: { starts_at: string; ends_at: string | null; status: string; purpose: string; round: number }[];
  round: number;
  checkedJobId: string;
  expectedJobId: string;
  events: string[];
  readsOk: boolean;
  paymentRows: number;
  invoiceRows: number;
  providerSends: number;
};
export function readyCheckWindowProofBlocker(p: WindowProof, now: Date): string | null {
  if (!p.readsOk || !p.expectedJobId || p.checkedJobId !== p.expectedJobId) return 'checked same-job readback required';
  if (piesaWindowBlockers(p.picks, now).length) return '3–5 allowed windows on at least three Melbourne business days required';
  const saved = p.saved.filter(w => w.purpose === 'ready_check' && w.round === p.round && w.status === 'available');
  const expected = p.picks.map(w => windowBounds(w.date, w.slot));
  if (saved.length !== expected.length || new Set(saved.map(w => `${w.starts_at}/${w.ends_at}`)).size !== expected.length || expected.some(w => !saved.some(s => s.starts_at === w.starts_at && s.ends_at === w.ends_at))) return 'exact persisted allowed windows not read back';
  if (p.events.some(e => /windows_not_saved|advance_blocked/.test(e))) return 'booking failure event recorded';
  if (![p.paymentRows, p.invoiceRows, p.providerSends].every(n => n === 0)) return 'payment, invoice or provider effect observed/unknown';
  return null;
}