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
  saved: { starts_at: string; ends_at: string | null; status: string; round: number }[];
  round: number;
  checkedJobId: string;
  expectedJobId: string;
  events: string[];
  readsOk: boolean;
  paymentRows: number;
  invoiceRows: number;
  providerSends: number;
};
function timestampEpoch(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const epoch = Date.parse(value);
  return Number.isFinite(epoch) ? epoch : null;
}
function windowEpochKey(w: { starts_at: string; ends_at: string | null }): string | null {
  const start = timestampEpoch(w.starts_at), end = timestampEpoch(w.ends_at);
  return start === null || end === null || end <= start ? null : `${start}/${end}`;
}
export function readyCheckWindowProofBlocker(p: WindowProof, now: Date): string | null {
  if (!p.readsOk || !p.expectedJobId || p.checkedJobId !== p.expectedJobId) return 'checked same-job readback required';
  if (piesaWindowBlockers(p.picks, now).length) return '3–5 allowed windows on at least three Melbourne business days required';
  const saved = p.saved.filter(w => w.round === p.round && w.status === 'open');
  const expected = p.picks.map(w => windowBounds(w.date, w.slot));
  const savedKeys = saved.map(windowEpochKey), expectedKeys = expected.map(windowEpochKey);
  if (savedKeys.some(k => k === null) || saved.length !== expected.length || new Set(savedKeys).size !== expected.length || expectedKeys.some(k => k === null || !savedKeys.includes(k))) return 'exact persisted allowed windows not read back';
  if (p.events.some(e => /windows_not_saved|advance_blocked/.test(e))) return 'booking failure event recorded';
  if (![p.paymentRows, p.invoiceRows, p.providerSends].every(n => n === 0)) return 'payment, invoice or provider effect observed/unknown';
  return null;
}
export type ReadyCheckFreeReadback = {
  readsOk: boolean;
  expectedJobId: string;
  acceptance: { job_id: string; ready_check_amount_inc_gst: number } | null;
  paymentState: { paymentId: string | null } | null;
};
export function readyCheckFreeProofBlocker(p: ReadyCheckFreeReadback): string | null {
  if (!p.readsOk || !p.expectedJobId || !p.acceptance || p.acceptance.job_id !== p.expectedJobId || !p.paymentState) return 'actual same-job acceptance and payment-state readback required';
  if (p.acceptance.ready_check_amount_inc_gst !== 0 || p.paymentState.paymentId !== null) return 'stored FREE amount 0 and paymentId null required';
  return null;
}
export function readyCheckScheduledProofBlocker(p: { readsOk: boolean; expectedJobId: string; job: { id: string; stage: string } | null; selected: { job_id: string; starts_at: string; ends_at: string | null; status: string } | null; booking: { job_id: string; starts_at: string; ends_at: string | null; status: string; kind: string } | null }): string | null {
  if (!p.readsOk || !p.expectedJobId || p.job?.id !== p.expectedJobId || p.selected?.job_id !== p.expectedJobId || p.booking?.job_id !== p.expectedJobId) return 'actual same-job selected window, booking and scheduled job readback required';
  if (p.job.stage !== 'ready_check_scheduled' || p.selected.status !== 'taken' || p.booking.kind !== 'ready_check' || p.booking.status !== 'confirmed') return 'taken window and confirmed Ready Check scheduled state required';
  const selected = windowEpochKey(p.selected), booking = windowEpochKey(p.booking);
  return selected && selected === booking ? null : 'scheduled booking must match selected persisted window';
}