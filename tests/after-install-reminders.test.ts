import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { memoryPostgrest } from './helpers/memory-postgrest';
import * as core from '../src/lib/after-install-reminders.core';
import * as balanceCore from '../src/lib/balance-q21.core';
import * as veecForm from '../src/lib/veec-assignment-form.core';
const { SMS_SEGMENT_LIMIT } = veecForm;
import * as veecEmails from '../src/lib/veec-emails.core';
import { SMS_MESSAGE_TYPES, SMS_FRESHNESS } from '../src/lib/sms.core';
import { buildNeedsRows } from '../src/lib/office-needs.core';
import { TEMPLATE_ENTRIES } from '../src/lib/template-hub.core';
import { WORKFLOW_DECISIONS } from '../src/config/workflow-decisions';
// Part 4 Task 12 (touchpoint 53, bal.png): one reminder on days 1, 3 and 7 after install day for what is still undone, then the
// office follows up as "Balance overdue".
const { afterInstallReminder, afterInstallReminderDue, balanceOverdueForOffice, afterInstallKey } = core;
const D = (s: string) => new Date(s);
const INSTALL_DAY = '2026-11-10';
const at = (ymd: string) => D(`${ymd}T02:00:00Z`); // 1pm Melbourne
const base = { installDay: INSTALL_DAY, veecSigned: false, balancePaid: false, done: [] as (1 | 3 | 7)[] };

test('flag is off by default and key shape is fixed', () => {
  expect(core.AFTER_INSTALL_REMINDERS_APPROVED).toBe(false);
  expect(afterInstallKey('j1', 3)).toBe('after-install:v1:j1:3');
});

test('due on days 1, 3 and 7 after install day; nothing before day 1 or after day 7', () => {
  expect(afterInstallReminderDue({ ...base, now: at('2026-11-10') })).toBeNull();
  expect(afterInstallReminderDue({ ...base, now: at('2026-11-11') })).toBe(1);
  expect(afterInstallReminderDue({ ...base, done: [1], now: at('2026-11-12') })).toBeNull();
  expect(afterInstallReminderDue({ ...base, done: [1], now: at('2026-11-13') })).toBe(3);
  expect(afterInstallReminderDue({ ...base, done: [1, 3], now: at('2026-11-16') })).toBeNull();
  expect(afterInstallReminderDue({ ...base, done: [1, 3], now: at('2026-11-17') })).toBe(7);
  expect(afterInstallReminderDue({ ...base, done: [1, 3, 7], now: at('2026-11-17') })).toBeNull();
  // After day 7 nothing goes to the owner any more (the office row takes over)
  expect(afterInstallReminderDue({ ...base, now: at('2026-11-18') })).toBeNull();
  expect(afterInstallReminderDue({ ...base, done: [1, 3], now: at('2026-11-25') })).toBeNull();
});

test('uses the Melbourne date, not UTC', () => {
  // 2026-11-10 23:30 UTC = 11 Nov 10:30am Melbourne = day 1
  expect(afterInstallReminderDue({ ...base, now: D('2026-11-10T23:30:00Z') })).toBe(1);
  expect(afterInstallReminderDue({ ...base, now: D('2026-11-10T12:00:00Z') })).toBeNull();
});

test('nothing when both are done, and a missed day never sends an older reminder after a newer one', () => {
  expect(afterInstallReminderDue({ ...base, veecSigned: true, balancePaid: true, now: at('2026-11-11') })).toBeNull();
  expect(afterInstallReminderDue({ ...base, done: [3], now: at('2026-11-14') })).toBeNull(); // 1 is never sent after 3
  expect(afterInstallReminderDue({ ...base, now: at('2026-11-12') })).toBe(1); // day 1 missed: still goes on day 2
  expect(afterInstallReminderDue({ ...base, installDay: '', now: at('2026-11-11') })).toBeNull();
});

const both = { firstName: 'Sarah', balance: '$1,412.00', veecSigned: false, balancePaid: false, link: 'https://example.invalid/my-job/t?screen=finish' };

test('both undone: day 1, 3 and 7 wording (email and text)', () => {
  const d1 = afterInstallReminder({ ...both, day: 1 });
  expect(d1.text).toContain('just 2 things left: sign your rebate form and pay your $1,412.00 balance');
  expect(d1.sms).toContain('just 2 things left: sign your rebate form and pay your $1,412.00 balance');
  const d3 = afterInstallReminder({ ...both, day: 3 });
  expect(d3.text).toContain('Reminder:');
  expect(d3.text).toContain('(it was due on install day)');
  expect(d3.sms).toContain('(it was due on install day)');
  const d7 = afterInstallReminder({ ...both, day: 7 });
  expect(d7.text).toContain('your $1,412.00 balance is now overdue. Please pay today');
  expect(d7.text).toContain("If you've already paid, thanks and please ignore this.");
  expect(d7.sms).toContain('your $1,412.00 balance is now overdue. Please pay today');
  expect(d7.sms).toContain("If you've already paid, thanks and please ignore this.");
  for (const m of [d1, d3, d7]) {
    expect(m.text).toContain('screen=finish');
    expect(m.html).toContain('screen=finish');
    expect(m.sms.length).toBeLessThanOrEqual(SMS_SEGMENT_LIMIT - 40); // room for the brand prefix
    expect(m.text + m.sms).not.toMatch(/lawyer|HIV\b/);
  }
});

test('only what is undone: balance paid, form unsigned has no balance words', () => {
  for (const day of [1, 3, 7] as const) {
    const m = afterInstallReminder({ ...both, day, balancePaid: true });
    for (const s of [m.subject, m.text, m.html, m.sms]) expect(s).not.toMatch(/balance|\$1,412|overdue|already paid|install day/i);
    expect(m.text).toMatch(/rebate form/);
    expect(m.sms).toMatch(/rebate form/);
  }
  expect(afterInstallReminder({ ...both, day: 1, balancePaid: true }).text).toContain('just 1 thing left: sign your rebate form');
});

test('only what is undone: form signed, balance unpaid has no rebate-form words', () => {
  for (const day of [1, 3, 7] as const) {
    const m = afterInstallReminder({ ...both, day, veecSigned: true });
    for (const s of [m.subject, m.text, m.html, m.sms]) expect(s).not.toMatch(/rebate|sign/i);
    expect(m.text).toContain('$1,412.00 balance');
  }
  expect(afterInstallReminder({ ...both, day: 1, veecSigned: true }).text).toContain('just 1 thing left: pay your $1,412.00 balance');
  expect(afterInstallReminder({ ...both, day: 7, veecSigned: true }).text).toContain('your $1,412.00 balance is now overdue. Please pay today');
});

test('a reminder for nothing is refused; the html carries the unsubscribe link', () => {
  expect(() => afterInstallReminder({ ...both, day: 1, veecSigned: true, balancePaid: true })).toThrow();
  const m = afterInstallReminder({ ...both, day: 1, unsubscribeUrl: 'https://example.invalid/unsub/abc' });
  expect(m.html).toContain('https://example.invalid/unsub/abc');
});

test('Balance overdue for the office: unpaid, after day 7 only', () => {
  expect(balanceOverdueForOffice({ installDay: INSTALL_DAY, balancePaid: false, now: at('2026-11-17') })).toBe(false); // day 7 itself
  expect(balanceOverdueForOffice({ installDay: INSTALL_DAY, balancePaid: false, now: at('2026-11-18') })).toBe(true);
  expect(balanceOverdueForOffice({ installDay: INSTALL_DAY, balancePaid: true, now: at('2026-11-30') })).toBe(false);
  expect(balanceOverdueForOffice({ installDay: '', balancePaid: false, now: at('2026-11-30') })).toBe(false);
});

// ---- the sweep (dependencies injected) ----
const { sweepAfterInstallReminders } = await import('../src/lib/after-install-reminders.server');
type Job = import('../src/lib/after-install-reminders.server').AfterInstallJob;
const job = (o: Partial<Job> = {}): Job => ({ jobId: 'j1', jobSource: 'real', installDay: INSTALL_DAY, veecSigned: false, balancePaid: false, balanceCents: 141200, firstName: 'Sarah', ownerEmail: 'o@example.invalid', ownerPhone: '0412345678', link: 'https://example.invalid/my-job/t', ...o });
function rig(jobs: Job[], opts: { approved?: boolean; legacy?: Record<string, (1 | 3 | 7)[]> } = {}) {
  const done: Record<string, (1 | 3 | 7)[]> = { ...(opts.legacy ?? {}) };
  const sent: { jobId: string; day: number; mail: ReturnType<typeof afterInstallReminder> }[] = [];
  const recorded: string[] = [];
  const deps = {
    approved: opts.approved ?? true,
    jobs: async () => jobs,
    doneDays: async (id: string) => done[id] ?? [],
    record: async (id: string, day: 1 | 3 | 7) => { recorded.push(`${id}:${day}`); (done[id] ??= []).push(day); },
    deliver: async (j: Job, day: 1 | 3 | 7, build: (u: string | null) => ReturnType<typeof afterInstallReminder>) => { sent.push({ jobId: j.jobId, day, mail: build(null) }); return 'sent'; },
  };
  return { deps, sent, recorded };
}

test('sweep: flag off sends nothing', async () => {
  const r = rig([job()], { approved: false });
  expect(await sweepAfterInstallReminders(at('2026-11-11'), r.deps)).toEqual({ checked: 0, sent: 0 });
  expect(r.sent).toEqual([]);
});

test('sweep: one reminder per job per tick, recorded once, not repeated', async () => {
  const r = rig([job()]);
  expect((await sweepAfterInstallReminders(at('2026-11-11'), r.deps)).sent).toBe(1);
  expect((await sweepAfterInstallReminders(at('2026-11-11'), r.deps)).sent).toBe(0);
  expect(r.recorded).toEqual(['j1:1']);
  expect(r.sent[0]!.mail.text).toContain('$1,412.00 balance');
  expect((await sweepAfterInstallReminders(at('2026-11-13'), r.deps)).sent).toBe(1);
  expect((await sweepAfterInstallReminders(at('2026-11-17'), r.deps)).sent).toBe(1);
  expect((await sweepAfterInstallReminders(at('2026-11-18'), r.deps)).sent).toBe(0);
  expect(r.sent.map((s) => s.day)).toEqual([1, 3, 7]);
});

test('sweep: done jobs, jobs with no balance amount or no link, and quiet hours send nothing and record nothing', async () => {
  const r = rig([job({ jobId: 'a', veecSigned: true, balancePaid: true }), job({ jobId: 'b', balanceCents: 0 }), job({ jobId: 'c', link: null })]);
  expect((await sweepAfterInstallReminders(at('2026-11-11'), r.deps)).sent).toBe(0);
  expect(r.recorded).toEqual([]);
  const q = rig([job()]);
  expect((await sweepAfterInstallReminders(D('2026-11-11T11:00:00Z'), q.deps)).sent).toBe(0); // 10pm Melbourne
  expect(q.recorded).toEqual([]);
  expect((await sweepAfterInstallReminders(at('2026-11-11'), q.deps)).sent).toBe(1);
});

test('sweep: only what is undone goes in the message', async () => {
  const r = rig([job({ jobId: 'p', veecSigned: true }), job({ jobId: 'f', balancePaid: true, balanceCents: 0 })]);
  await sweepAfterInstallReminders(at('2026-11-11'), r.deps);
  const byJob = Object.fromEntries(r.sent.map((s) => [s.jobId, s.mail.text]));
  expect(byJob['p']).not.toMatch(/rebate/i);
  expect(byJob['f']).not.toMatch(/balance/i);
});

test('sweep: a job that already got an old reminder for a day does not get the new one for that day (in-flight)', async () => {
  // legacy days arrive through doneDays (old veec_sign_reminder steps and the old balance "due" email)
  const r = rig([job()], { legacy: { j1: [1] } });
  expect((await sweepAfterInstallReminders(at('2026-11-11'), r.deps)).sent).toBe(0);
  expect((await sweepAfterInstallReminders(at('2026-11-13'), r.deps)).sent).toBe(1);
  expect(r.sent[0]!.day).toBe(3);
});

test('sweep: one job failing does not stop the next', async () => {
  const r = rig([job({ jobId: 'x' }), job({ jobId: 'y' })]);
  const orig = r.deps.deliver;
  r.deps.deliver = async (j, d, b) => { if (j.jobId === 'x') throw new Error('boom'); return orig(j, d, b); };
  const out = await sweepAfterInstallReminders(at('2026-11-11'), r.deps);
  expect(out.sent).toBe(1);
  expect(r.sent[0]!.jobId).toBe('y');
});

// ---- default dependencies read the right history ----
test('doneDays reads the new events and the old reminders (rebate form days, balance due email)', async () => {
  const rows = {
    workflow_events: [
      { job_id: 'j1', event_type: 'after_install_reminder', details: { day: 1 } },
      { job_id: 'j1', event_type: 'veec_sign_reminder', details: { step: 'reminder_3' } },
      { job_id: 'j1', event_type: 'veec_sign_reminder', details: { step: 'request' } },
      { job_id: 'j2', event_type: 'veec_sign_reminder', details: { step: 'reminder_7' } },
    ],
    customer_email_sends: [
      { job_id: 'j1', purpose: 'balance_reminder', idempotency_key: 'balance-q21:i:2026-11-17T13:00:00Z:day5' },
      { job_id: 'j1', purpose: 'balance_reminder', idempotency_key: 'balance-q21:i:2026-11-17T13:00:00Z:due' },
    ],
  };
  const { readDoneDays } = await import('../src/lib/after-install-reminders.server');
  expect((await readDoneDays('j1', memoryPostgrest(rows) as never)).sort()).toEqual([1, 3, 7]);
  expect(await readDoneDays('j2', memoryPostgrest(rows) as never)).toEqual([7]);
  expect(await readDoneDays('j3', memoryPostgrest(rows) as never)).toEqual([]);
});

// ---- the old senders stop when the new reminders are on ----
function load(path: string, deps: Record<string, unknown>) {
  const api: Record<string, any> = {};
  new Function('exports', 'require', ts.transpile(readFileSync(path, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (name: string) => { if (!(name in deps)) throw Error(`Unmocked ${name}`); return deps[name]; });
  return api;
}
function balanceSweep(flag: boolean) {
  const rows = { jobs: [{ id: 'j', stage: 'evidence_outstanding', installation_completed_at: '2026-11-01T23:00:00Z', deleted_at: null }] };
  const captured: string[] = []; let dates = 0;
  const api = load('src/lib/balance-q21.server.ts', {
    '@/integrations/supabase/client.server': { supabaseAdmin: memoryPostgrest(rows) }, './balance-q21.core': balanceCore, './payments.core': { isStepPaid: () => false },
    './after-install-reminders.core': { ...core, AFTER_INSTALL_REMINDERS_APPROVED: flag },
    './payments.server': { jobPaymentView: async () => ({ invoices: { install: { id: 'i' } }, steps: [] }) }, './invoice-dates.server': { setCompletedBalanceDueDate: async () => dates++ },
    './mail-mjml.core': { genericMail: () => '<captured>' }, './owner-template-send.server': { sendOwnerTemplateEmail: async (p: any) => { captured.push(p.render({ myJobUrl: 'https://example.invalid/my-job/t' }).subject); return 'sent'; } },
  });
  return { api, captured, dates: () => dates };
}
test('old balance day-5 / due emails: unchanged flag off, stopped flag on (the due-date retry still runs)', async () => {
  const off = balanceSweep(false);
  await off.api.sweepBalanceQ21(new Date('2026-11-06T23:00:00Z'));
  expect(off.captured).toEqual(['Your balance is due in 2 days']);
  const on = balanceSweep(true);
  await on.api.sweepBalanceQ21(new Date('2026-11-06T23:00:00Z'));
  await on.api.sweepBalanceQ21(new Date('2026-11-08T23:00:00Z'));
  expect(on.captured).toEqual([]);
  expect(on.dates()).toBe(2);
});

function veecSweep(flag: boolean, nowIso: string) {
  const rows = {
    jobs: [{ id: 'j', stage: 'evidence_outstanding', installation_completed_at: '2026-11-01T23:00:00Z', deleted_at: null }],
    workflow_events: [{ job_id: 'j', event_type: 'veec_sign_reminder', details: { step: 'request' } }], customer_assignments: [],
  };
  const logged: string[] = [];
  const api = load('src/lib/veec-reminders.server.ts', {
    '@/integrations/supabase/client.server': { supabaseAdmin: memoryPostgrest(rows) }, './workflow.server': { logEvent: async (_j: string, _a: unknown, t: string, _m: string, d: any) => { logged.push(`${t}:${d?.step ?? ''}`); } },
    './veec-copy-email.server': { sendVeecCopyEmail: async () => 'x', ownerMyJobLink: async () => null }, './veec-assignment-form.core': veecForm, './veec-emails.core': veecEmails, './after-install-reminders.core': { ...core, AFTER_INSTALL_REMINDERS_APPROVED: flag },
  });
  return { run: () => api.sweepVeecReminders(new Date(nowIso)), logged };
}
test('old rebate-form reminders (O61 days 1/3/7): unchanged flag off, stopped flag on; day-10 office alert kept', async () => {
  const off = veecSweep(false, '2026-11-03T02:00:00Z'); // 2 days after: reminder_1 due
  await off.run();
  expect(off.logged[0]).toBe('veec_sign_reminder:reminder_1');
  const on = veecSweep(true, '2026-11-03T02:00:00Z');
  await on.run();
  expect(on.logged).toEqual([]);
  const day10 = veecSweep(true, '2026-11-12T02:00:00Z');
  await day10.run();
  expect(day10.logged).toEqual(['veec_sign_reminder:office_alert_10', 'veec_assignment_unsigned_10_days:office_alert_10']);
});

// ---- office row, texts, register, source of truth ----
test('office Needs me row says Balance overdue for the install balance when the new reminders are on', () => {
  const now = Date.parse('2026-11-20T00:00:00Z');
  const f = { jobId: 'j', jobNumber: 'HV-1', surname: 'Yang', suburb: 'Kew', paymentsOverdue: [{ at: '2026-11-17T13:00:00Z', text: '$1,412 owing', invoice: 'install' as const, reference: 'INV-0101', balance: true }] };
  const lines = (jobs: unknown[]) => buildNeedsRows({ now, jobs: jobs as never }).watch.map((r) => r.line);
  expect(lines([f])).toEqual(['Balance overdue · chase · Install INV-0101 · $1,412 owing']);
  expect(lines([{ ...f, paymentsOverdue: [{ ...f.paymentsOverdue[0]!, balance: undefined }] }])).toEqual(['Payment overdue · chase · Install INV-0101 · $1,412 owing']);
});

test('text type is registered for owners with quiet hours, window freshness', () => {
  expect(SMS_MESSAGE_TYPES.after_install_reminder).toMatchObject({ audience: 'owner', quietHours: true });
  expect(SMS_FRESHNESS.after_install_reminder).toEqual({ kind: 'window' });
});

test('templates register lists the new email and text; source of truth and workflow decisions state the rule', () => {
  const ids = TEMPLATE_ENTRIES.map((t) => t.id);
  expect(ids).toContain('owner:after-install-reminder');
  expect(ids).toContain('owner:sms-after_install_reminder');
  const sot = readFileSync('docs/HIV_WORKFLOW_SOURCE_OF_TRUTH.md', 'utf8');
  expect(sot).toContain('AFTER_INSTALL_REMINDERS_APPROVED');
  expect(sot).toContain('Balance overdue');
  expect(sot).not.toMatch(/Email reminders on day 5 and due day/);
  expect(WORKFLOW_DECISIONS.payment.afterInstallReminders).toMatchObject({ days: [1, 3, 7], officeRowAfterDay: 7 });
});
