import { beforeEach, expect, mock, test } from 'bun:test';
import { memoryPostgrest, type Tables } from './helpers/memory-postgrest';
// Part 4 Task 4: "Your safety check found electrical upgrades needed" (#42). Core wording + the server send (flag, route, deliveries).
const tables: Tables = {}; const admin = memoryPostgrest(tables);
const emails: any[] = [], texts: any[] = [], recorded: any[] = [], guards: any[] = [];
const emailKeys = new Set<string>();
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: admin }));
mock.module('../src/lib/comms.server', () => ({ assertCustomerDeliveryAllowed: async (_j: string, _l: string, purpose?: string) => { guards.push(purpose ?? null); } }));
mock.module('../src/lib/owner-email-send.server', () => ({ sendGuardedOwnerEmail: async (p: any) => { if (emailKeys.has(p.key)) return 'already attempted'; emailKeys.add(p.key); tables.customer_email_sends.push({ job_id: p.jobId, idempotency_key: p.key, status: 'sent' }); emails.push({ ...p, mail: p.build(null) }); return 'sent'; } }));
mock.module('../src/lib/sms.server', () => ({ sendRealSms: async (p: any) => { texts.push(p); return { status: 'sent' }; } }));
const { upgradesNeededEmail, upgradesNeededText, upgradesNeededKey } = await import('../src/lib/upgrades-needed.core');
const { sweepUpgradesNeeded } = await import('../src/lib/upgrades-needed.server');
const { SMS_MESSAGE_TYPES, SMS_FRESHNESS } = await import('../src/lib/sms.core');
const { COMPLIANCE_OWNER_EMAIL_PURPOSES } = await import('../src/lib/do-not-contact.core');
const { piesaResultRoute, ownerStandaloneDue, UPGRADES_NEEDED_EMAIL_APPROVED } = await import('../src/lib/piesa-result-route.core');

const electrician = { name: 'Viking Electrical', tradingName: null, officePhone: '03 9111 1111', email: 'jobs@viking.example' };
const input = { firstName: 'Sarah', found: ['Old wiring near the manhole', 'Missing safety switch'], electrician, installer: 'Rapid Insulation', installBy: '2026-12-05', depositCents: 15700, confirmUrl: 'https://example.invalid/my-job/t?screen=clear' };

test('wording (upg-both.png #42, answer 21 step 2 is a draft for Jo)', () => {
  const m = upgradesNeededEmail(input);
  expect(m.subject).toBe('Your safety check found electrical upgrades needed');
  for (const s of [
    'Old wiring near the manhole', 'Missing safety switch',
    '1. Viking Electrical will quote the upgrades and book them with you directly. You pay them, not us.',
    "2. You don't need to wait for the upgrades: confirm your safety check and pay your deposit now, then Rapid Insulation will call you to book your install day.",
    '$157.00 inc GST',
    'Confirm and pay my deposit: https://example.invalid/my-job/t?screen=clear',
    'The 30-day rule: Your insulation must be installed within 30 days of this check, or it has to be done again.',
    'Install by Saturday 5 December.',
    'Viking Electrical · 03 9111 1111 · jobs@viking.example',
  ]) expect(m.text).toContain(s);
  expect(m.text).not.toContain("Once the upgrades are done, we'll email you");
  expect(m.text).not.toMatch(/fixes|repairs|lawyer|HIV\b/i);
  expect(m.html).toContain('Confirm and pay my deposit');
  expect(m.html).toContain('screen=clear');
});
test('held when the electrician has no office phone or email', () => {
  expect(() => upgradesNeededEmail({ ...input, electrician: { ...electrician, officePhone: null } })).toThrow();
});
test('text (#42 verbatim)', () => {
  expect(upgradesNeededText('Sarah', 'Viking Electrical')).toBe('Home Insulation Victoria: Hi Sarah, your safety check found electrical upgrades needed. Viking Electrical will quote and book them with you directly. Details in your email.');
});
test('text type: owner, approved wording, quiet hours, fresh for a day', () => {
  expect(SMS_MESSAGE_TYPES.upgrades_needed).toMatchObject({ audience: 'owner', wordingApproved: true, quietHours: true });
  expect(SMS_FRESHNESS.upgrades_needed).toEqual({ kind: 'event', maxAgeMinutes: 24 * 60 });
});
test('flag is off, and the route follows it', () => {
  expect(UPGRADES_NEEDED_EMAIL_APPROVED).toBe(true); // ON at go-live 5 Nov 2026
  const f = { outcome: 'upgrades_needed' as const, upgradesDoneSameDay: false, doNotContact: false, newFlow: true };
  expect(piesaResultRoute(f)).toEqual(['upgrades_needed']); // the constant is ON
  expect(piesaResultRoute(f, { clearToInstall: false, upgradesNeeded: false })).toEqual(['standalone_copy']);
  expect(piesaResultRoute(f, { clearToInstall: false, upgradesNeeded: true })).toEqual(['upgrades_needed']);
  expect(piesaResultRoute({ ...f, upgradesDoneSameDay: true }, { clearToInstall: true, upgradesNeeded: true })).toEqual(['clear_to_install']);
  expect(piesaResultRoute({ ...f, doNotContact: true }, { clearToInstall: true, upgradesNeeded: true })).toEqual(['standalone_copy']);
});
test('24h safety net covers the upgrades route', () => {
  const r = '2026-11-01T00:00:00Z';
  const f = { route: ['upgrades_needed' as const], resultAt: r, ownerDelivered: false };
  expect(ownerStandaloneDue({ ...f, now: new Date('2026-11-01T10:00:00Z') })).toBe(false);
  expect(ownerStandaloneDue({ ...f, now: new Date('2026-11-02T01:00:00Z') })).toBe(true);
  expect(ownerStandaloneDue({ ...f, now: new Date('2026-11-02T01:00:00Z'), ownerDelivered: true })).toBe(false);
});
test('compliance purpose is piesa_copy', () => { expect(COMPLIANCE_OWNER_EMAIL_PURPOSES).toContain('piesa_copy'); });

const PDF = { filename: 'piesa.pdf', content: 'AA==', contentType: 'application/pdf' };
let route: string[] = ['upgrades_needed'], held: string | null = null, phoneMissing = false;
const facts = () => held ? { held } : {
  jobSource: 'website', piesaRecordId: 'r', signedCopyId: 'c', resultAt: '2026-11-01T00:00:00Z', ownerEmail: 'owner@example.invalid', ownerPhone: '0412345678', firstName: 'Sarah',
  found: input.found, electrician: phoneMissing ? { ...electrician, officePhone: null } : electrician, installer: 'Rapid Insulation', installBy: '2026-12-05', depositCents: 15700,
  confirmUrl: 'https://example.invalid/my-job/t?screen=clear', attachments: [PDF],
};
const deps = (over: Record<string, unknown> = {}) => ({
  approved: true,
  candidates: async () => ['j'],
  route: async () => route as any,
  facts: async () => facts() as any,
  record: async (p: any) => { recorded.push(p); tables.piesa_deliveries.push({ piesa_record_id: p.piesaRecordId, recipient: p.recipient }); },
  ...over,
});
const at = new Date('2026-11-02T00:00:00Z'); // 11am Melbourne
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.customer_email_sends = []; tables.piesa_deliveries = []; tables.piesa_records = [{ id: 'r', job_id: 'j', is_current: true }];
  emails.length = texts.length = recorded.length = guards.length = 0; emailKeys.clear();
  route = ['upgrades_needed']; held = null; phoneMissing = false;
});

test('flag on, upgrades route: one email with the PIESA attached, compliance purpose, owner delivery recorded once, one text', async () => {
  const a = await sweepUpgradesNeeded(at, deps()); await sweepUpgradesNeeded(at, deps());
  expect(a).toEqual({ checked: 1, sent: 1 });
  expect(emails).toHaveLength(1);
  expect(emails[0].key).toBe(upgradesNeededKey('r'));
  expect(emails[0].key).toBe('upgrades-needed:v1:r');
  expect(emails[0].purpose).toBe('piesa_copy');
  expect(guards).toContain('piesa_copy');
  expect(emails[0].mail.subject).toBe('Your safety check found electrical upgrades needed');
  expect(emails[0].mail.attachments).toEqual([PDF]);
  expect(recorded).toEqual([{ jobId: 'j', recipient: 'owner', piesaRecordId: 'r', signedCopyId: 'c', recipientUserId: null, to: 'owner@example.invalid', detail: 'with the "Electrical upgrades needed" email' }]);
  expect(texts).toHaveLength(1);
  expect(texts[0]).toMatchObject({ type: 'upgrades_needed', jobId: 'j', to: '0412345678', idempotencyKey: 'upgrades-needed:v1:r:sms', body: upgradesNeededText('Sarah', 'Viking Electrical') });
});
test('flag off: nothing', async () => {
  expect(await sweepUpgradesNeeded(at, deps({ approved: false }))).toEqual({ checked: 0, sent: 0 });
  expect(emails).toHaveLength(0);
});
test('other routes (clear, standalone / do not contact): no upgrades email', async () => {
  for (const r of [['clear_to_install'], ['standalone_copy']]) { route = r; await sweepUpgradesNeeded(at, deps()); }
  expect(emails).toHaveLength(0); expect(texts).toHaveLength(0); expect(recorded).toHaveLength(0);
});
test('electrician office phone missing: held, nothing sent or recorded', async () => {
  phoneMissing = true;
  expect(await sweepUpgradesNeeded(at, deps())).toEqual({ checked: 1, sent: 0 });
  expect(emails).toHaveLength(0); expect(texts).toHaveLength(0); expect(recorded).toHaveLength(0);
});
test('facts held (PIESA PDF missing, deposit paid, install booked, no deadline): nothing sent', async () => {
  held = 'Upgrades needed documents not ready';
  expect(await sweepUpgradesNeeded(at, deps())).toEqual({ checked: 1, sent: 0 });
  expect(emails).toHaveLength(0); expect(recorded).toHaveLength(0);
});
test('quiet hours: neither email nor text', async () => {
  expect(await sweepUpgradesNeeded(new Date('2026-11-01T11:00:00Z'), deps())).toEqual({ checked: 1, sent: 0 }); // 10pm Melbourne
  expect(emails).toHaveLength(0); expect(texts).toHaveLength(0);
});
test('owner without a mobile: email only', async () => {
  await sweepUpgradesNeeded(at, deps({ facts: async () => ({ ...(facts() as any), ownerPhone: null }) }));
  expect(emails).toHaveLength(1); expect(texts).toHaveLength(0);
});
test('sent but the delivery row never landed: recorded on the next tick, no second email', async () => {
  await sweepUpgradesNeeded(at, deps({ record: async () => { throw Error('crash'); } }));
  expect(emails).toHaveLength(1); expect(recorded).toHaveLength(0);
  await sweepUpgradesNeeded(at, deps());
  expect(emails).toHaveLength(1); expect(recorded).toHaveLength(1);
});
test('already recorded owner delivery: nothing rebuilt or recorded', async () => {
  await sweepUpgradesNeeded(at, deps());
  tables.piesa_deliveries.push({ piesa_record_id: 'r', recipient: 'owner' });
  recorded.length = 0;
  await sweepUpgradesNeeded(at, deps());
  expect(emails).toHaveLength(1); expect(recorded).toHaveLength(0);
});
