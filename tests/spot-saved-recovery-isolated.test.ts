import { afterAll, beforeEach, expect, mock, test, setSystemTime } from 'bun:test';

type Row = Record<string, any>;
const rows: Record<string, Row[]> = {};
let emailCalls = 0, smsCalls = 0, readFailure: string | null = null;
const db = { from(table: string) {
  let op = 'read', payload: Row = {}, lo = 0, hi = Infinity;
  const predicates: ((r: Row) => boolean)[] = [];
  const q: any = {
    select: () => q, eq: (k: string, v: unknown) => { predicates.push(r => r[k] === v); return q; },
    in: (k: string, v: unknown[]) => { predicates.push(r => v.includes(r[k])); return q; },
    is: (k: string, v: unknown) => { predicates.push(r => (r[k] ?? null) === v); return q; },
    not: (k: string) => { predicates.push(r => r[k] != null); return q; },
    neq: (k: string, v: unknown) => { predicates.push(r => r[k] !== v); return q; },
    or: () => q, order: () => q, limit: (n: number) => { hi = n - 1; return q; },
    range: (a: number, b: number) => { lo = a; hi = b; return q; },
    insert: (p: Row) => { op = 'insert'; payload = p; return q; },
    update: (p: Row) => { op = 'update'; payload = p; return q; },
    maybeSingle: () => result(true), single: () => result(true),
    then: (resolve: any, reject: any) => result(false).then(resolve, reject),
  };
  async function result(single: boolean) {
    if (readFailure === table) return { data: null, error: { message: 'read failed', code: 'XX000' } };
    const list = rows[table] ?? (rows[table] = []);
    if (op === 'insert') {
      if (payload.id && list.some(r => r.id === payload.id)) return { data: null, error: { code: '23505', message: 'duplicate' } };
      if (payload.idempotency_key && list.some(r => r.idempotency_key === payload.idempotency_key)) return { data: null, error: { code: '23505', message: 'duplicate' } };
      const r = { id: `row-${list.length}`, ...payload }; list.push(r); return { data: single ? r : [r], error: null };
    }
    const found = list.filter(r => predicates.every(p => p(r)));
    if (op === 'update') for (const r of found) Object.assign(r, payload);
    const data = found.slice(lo, hi + 1);
    return { data: single ? data[0] ?? null : data, error: null, count: data.length };
  }
  return q;
} };
mock.module('../src/integrations/supabase/client.server', () => ({ supabaseAdmin: db }));
mock.module('../src/lib/workflow.server', () => ({ logEvent: async (job_id: string, _actor: unknown, event_type: string, _summary: string, details: Row) => {
  (rows.workflow_events ??= []).push({ job_id, event_type, details, created_at: new Date().toISOString() });
} }));
mock.module('../src/lib/comms.server', () => ({ hasCurrentOwnerContactConsent: async () => true, recordCommunication: async () => {} }));
mock.module('../src/lib/emailsafety.server', () => ({ unsubscribeUrlForJob: async () => null }));
mock.module('../src/lib/referral.server', () => ({ referralUrlForJob: async () => null }));
mock.module('../src/lib/hot-leads-send.server', () => ({ resendSend: async () => { emailCalls++; return { outcome: 'accepted', id: 'provider' }; } }));
mock.module('../src/lib/sms.server', () => ({ sendRealSms: async (input: Row) => {
  const { data, error } = await db.from('sms_messages').insert({ job_id: input.jobId, idempotency_key: input.idempotencyKey, status: 'sent' }).select('id').single();
  if (error || !data) return { status: 'already', detail: 'Existing claim' };
  smsCalls++; return { status: 'sent', detail: 'Mock accepted' };
} }));

const { sweepSpotSavedConfirmations, spotSavedConfirmationHandled } = await import('../src/lib/spot-saved-recovery.server');
function home(id: string, options: Row = {}) {
  const source = options.source ?? 'base44';
  (rows.jobs ??= []).push({ id, source, stage: 'ready_check_ready_to_schedule', deleted_at: null, qa_archived_at: null, owners: { full_name: 'Test Home', email: `${id}@example.org.au`, phone: '0412345678' }, properties: { suburb: 'Test suburb' } });
  (rows.lead_campaign_responses ??= []).push({ id, job_id: id, spot_saved_at: '2026-10-30T06:15:00Z', opted_out_at: null, saved_veu_discount: 1470, saved_gross_total: 5198, saved_total: 3728, saved_area_m2: 150, jobs: { source, stage: 'ready_check_ready_to_schedule', deleted_at: null, qa_archived_at: null } });
  (rows.customer_estimate_links ??= []).push({ job_id: id, token: 'test-link', purpose: 'step3_estimate', status: 'active' });
  if (options.queued) rows.workflow_events.push({ job_id: id, event_type: 'spot_saved_confirmation_queued', details: {} });
  if (options.completed) rows.workflow_events.push({ job_id: id, event_type: 'spot_saved_confirmation_completed', details: {} });
  if (options.preliminary) rows.workflow_events.push({ job_id: id, event_type: 'campaign_spot_saved', details: { preliminary_email: true } });
}
beforeEach(() => {
  setSystemTime(new Date('2026-10-30T06:30:00Z'));
  for (const k of Object.keys(rows)) delete rows[k];
  rows.workflow_events = []; rows.workflow_settings = [{ id: 1, customer_comms_enabled: true, sms_message_switches: { spot_saved_email: true, spot_saved: true } }];
  emailCalls = 0; smsCalls = 0; readFailure = null;
});
afterAll(() => setSystemTime());
test('email already and expired 24h SMS complete once without blocked rows or no-change attempts', async () => {
  home('expired', { queued: true });
  rows.customer_email_sends = [{ job_id: 'expired', purpose: 'spot_saved_confirmation', status: 'sent' }];
  setSystemTime(new Date('2026-10-31T06:30:00Z'));
  await sweepSpotSavedConfirmations(); await sweepSpotSavedConfirmations();
  expect(emailCalls).toBe(0); expect(smsCalls).toBe(0);
  expect(rows.sms_messages ?? []).toHaveLength(0);
  expect(rows.workflow_events.filter(r => r.event_type === 'spot_saved_confirmation_completed')).toHaveLength(1);
  expect(rows.workflow_events.filter(r => ['spot_saved_confirmation_sent', 'spot_saved_confirmation_recovery_attempted'].includes(r.event_type))).toHaveLength(0);
});
test('quiet hours stay pending without history churn and resume at 7am Melbourne', async () => {
  home('overnight', { queued: true });
  rows.customer_email_sends = [{ job_id: 'overnight', purpose: 'spot_saved_confirmation', status: 'sent' }];
  setSystemTime(new Date('2026-10-30T10:00:00Z'));
  await sweepSpotSavedConfirmations(); await sweepSpotSavedConfirmations();
  expect(smsCalls).toBe(0); expect(rows.sms_messages ?? []).toHaveLength(0);
  expect(rows.workflow_events).toHaveLength(1);
  setSystemTime(new Date('2026-10-30T20:00:00Z'));
  await sweepSpotSavedConfirmations(); expect(smsCalls).toBe(1);
  expect(rows.workflow_events.filter(r => r.event_type === 'spot_saved_confirmation_completed')).toHaveLength(1);
});
test('a missing mobile completes after email once, without attempting SMS', async () => {
  home('no-mobile'); rows.jobs[0].owners.phone = null;
  await sweepSpotSavedConfirmations(); await sweepSpotSavedConfirmations();
  expect(emailCalls).toBe(1); expect(smsCalls).toBe(0);
  expect(rows.workflow_events.filter(r => r.event_type === 'spot_saved_confirmation_completed')).toHaveLength(1);
});
test('a failed email with an expired text stays pending, not completed', async () => {
  home('email-failed'); readFailure = 'customer_email_sends';
  setSystemTime(new Date('2026-10-31T06:30:00Z'));
  // Policy classifier must never complete a failed email even when the text is terminal.
  expect(spotSavedConfirmationHandled({ email: { status: 'failed' }, sms: { status: 'blocked', detail: 'Too late to send – the trigger was 25h ago (limit 24h)' } })).toBe(false);
});
test('only a missing mobile or expired 24h hold is terminal; switches, STOP, missing link and quiet hours are not', () => {
  const email = { status: 'already' };
  expect(spotSavedConfirmationHandled({ email, sms: { status: 'skipped', detail: 'No valid mobile' } })).toBe(true);
  expect(spotSavedConfirmationHandled({ email, sms: { status: 'already' } })).toBe(true);
  expect(spotSavedConfirmationHandled({ email: { status: 'sent' }, sms: { status: 'sent' } })).toBe(true);
  for (const detail of ['Spot saved texts are switched off', 'Replied STOP', 'No saved estimate link for the approved text', 'Quiet hours: after 8pm']) {
    expect(spotSavedConfirmationHandled({ email, sms: { status: 'skipped', detail } })).toBe(false);
  }
});
test('saved without a queue is recovered through the real sender, then never sent twice', async () => {
  home('missing'); await sweepSpotSavedConfirmations(); await sweepSpotSavedConfirmations();
  expect(emailCalls).toBe(1); expect(smsCalls).toBe(1);
  expect(rows.workflow_events.filter(r => r.event_type === 'spot_saved_confirmation_completed')).toHaveLength(1);
});
test('queued interruption and concurrent recovery share per-owner delivery claims', async () => {
  home('queued', { queued: true });
  await Promise.all([sweepSpotSavedConfirmations(), sweepSpotSavedConfirmations()]);
  expect(emailCalls).toBe(1); expect(smsCalls).toBe(1);
  expect(rows.workflow_events.filter(r => r.event_type === 'spot_saved_confirmation_completed')).toHaveLength(1);
});
test('partial delivery retries only the channel without a claim', async () => {
  home('partial', { queued: true }); rows.customer_email_sends = [{ id: 'prior', idempotency_key: 'spot_saved_confirmation:v1:partial@example.org.au', status: 'sent' }];
  await sweepSpotSavedConfirmations(); expect(emailCalls).toBe(0); expect(smsCalls).toBe(1);
});
test('completed and TEST saves never dispatch', async () => {
  home('complete', { completed: true }); home('practice', { source: 'qa_test' });
  await sweepSpotSavedConfirmations(); expect(emailCalls).toBe(0); expect(smsCalls).toBe(0);
});
test('preliminary email-only saves keep their existing no-text rule', async () => {
  home('preliminary', { preliminary: true }); await sweepSpotSavedConfirmations();
  expect(emailCalls).toBe(1); expect(smsCalls).toBe(0);
});
test('paused confirmations remain pending and recover once permitted', async () => {
  home('paused'); rows.workflow_settings[0].customer_comms_enabled = false;
  await sweepSpotSavedConfirmations(); expect(emailCalls).toBe(0); expect(smsCalls).toBe(0);
  expect(rows.workflow_events.some(r => r.event_type === 'spot_saved_confirmation_completed')).toBe(false);
  rows.workflow_settings[0].customer_comms_enabled = true; await sweepSpotSavedConfirmations();
  expect(emailCalls).toBe(1); expect(smsCalls).toBe(1);
});
test('read failure discards the sweep before any send', async () => {
  home('error'); readFailure = 'workflow_events';
  await expect(sweepSpotSavedConfirmations()).rejects.toThrow('read failed'); expect(emailCalls).toBe(0); expect(smsCalls).toBe(0);
});
test('more than a page of completed saves cannot hide an unqueued save', async () => {
  for (let i = 0; i < 205; i++) home(`done-${i}`, { completed: true });
  home('last'); await sweepSpotSavedConfirmations(); expect(emailCalls).toBe(1); expect(smsCalls).toBe(1);
});
test('pending policy holds cannot starve later saved homes across ticks', async () => {
  for (let i = 0; i < 21; i++) home(`held-${i}`);
  rows.workflow_settings[0].customer_comms_enabled = false;
  await sweepSpotSavedConfirmations();
  rows.workflow_settings[0].customer_comms_enabled = true;
  await sweepSpotSavedConfirmations();
  expect(rows.customer_email_sends.some(r => r.job_id === 'held-20')).toBe(true);
});
test('failure on a later selection page sends nothing from earlier pages', async () => {
  for (let i = 0; i < 205; i++) home(`candidate-${i}`);
  readFailure = 'workflow_events'; await expect(sweepSpotSavedConfirmations()).rejects.toThrow('read failed');
  expect(emailCalls).toBe(0); expect(smsCalls).toBe(0);
});