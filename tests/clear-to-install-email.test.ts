import { beforeEach, expect, mock, test } from 'bun:test';
import { memoryPostgrest, type Tables } from './helpers/memory-postgrest';
// Part 4 Task 3: "You're clear to install" (#40). Core wording + the server send (flag on/off, attachments, deliveries).
const tables: Tables = {}; const admin = memoryPostgrest(tables);
let paidNow = false, bookedNow = false, deadlineNow: string | null = '2026-12-05';
let outcome: 'pass' | 'fail' = 'pass', inputsOk = true, routeClear = true, paused = false, unsubscribed = false;
const emails: any[] = [], texts: any[] = [], recorded: any[] = [], guards: any[] = [];
const emailKeys = new Set<string>();
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: admin }));
mock.module('../src/lib/in-house-suppression.server', () => ({ readInHouseDispatchState: async () => ({ failed: false, held: new Set(['j']) }) }));
mock.module('../src/lib/allocation.server', () => ({ clearanceFacts: async () => ({ piesaOutcome: outcome }) }));
mock.module('../src/lib/install-days.server', () => ({ installDayContext: async () => ({ clearance: { cleared: true, basis: 'initial_piesa' }, deadline: deadlineNow, booked: bookedNow }) }));
mock.module('../src/lib/payments.server', () => ({ jobPaymentView: async () => ({ invoiceId: 'i', invoices: { install: { id: 'i', xero_invoice_id: 'x' } }, plan: { installDepositCents: 15700 }, steps: [{ key: 'install_deposit', state: paidNow ? 'paid' : 'due', outstandingCents: paidNow ? 0 : 15700 }], bank: { configured: true, accountName: 'P', bsb: '123456', accountNumber: '12345678' }, reference: 'INV-1', stripe: { available: true } }) }));
mock.module('../src/lib/veec-copy-email.server', () => ({ ownerMyJobLink: async () => 'https://example.invalid/my-job/token' }));
mock.module('../src/lib/comms.server', () => ({ assertCustomerDeliveryAllowed: async (_j: string, _l: string, purpose?: string) => { guards.push(purpose ?? null); if (paused) throw Error('held'); if (unsubscribed && purpose !== 'piesa_copy') throw Error('unsubscribed'); } }));
mock.module('../src/lib/owner-email-send.server', () => ({ sendGuardedOwnerEmail: async (p: any) => { if (emailKeys.has(p.key)) return 'already attempted'; emailKeys.add(p.key); emails.push({ ...p, mail: p.build(null) }); return 'sent'; } }));
mock.module('../src/lib/sms.server', () => ({ sendRealSms: async (p: any) => { texts.push(p); return { status: 'sent' }; } }));
const { renderInstallDepositOwnerEmail } = await import('../src/lib/deposit-request-email.core');
const { requestInstallDeposit } = await import('../src/lib/deposit-request.server');
const { ownerStandaloneDue } = await import('../src/lib/piesa-result-route.core');
const { resolveOwnerStandalone } = await import('../src/lib/piesa-delivery.server');
const { COMPLIANCE_OWNER_EMAIL_PURPOSES } = await import('../src/lib/do-not-contact.core');

const facts = { name: 'Sarah', firstName: 'Sarah', installer: 'Rapid Insulation', jobNumber: 'HV-1', address: '1 A St', ownerPhone: null, deadline: '2026-12-05', amountCents: 15700, link: 'https://example.invalid/my-job/t?screen=clear', bank: { configured: true, accountName: 'P', bsb: '1', accountNumber: '2' }, reference: 'R', card: true, checkedOn: '2026-11-07', electrician: 'Viking Electrical', upgrades: 'None' as const };

test('clear-to-install wording (clear.png + decision 40)', () => {
  const m = renderInstallDepositOwnerEmail(facts, 'request', true);
  expect(m.subject).toBe("You're clear to install");
  for (const s of [
    'Your electrical safety check (PIESA) is all clear. One last step to book your install day:',
    'Confirm your safety check and pay your deposit',
    '$157.00 inc GST',
    'Confirm and pay my deposit: https://example.invalid/my-job/t?screen=clear',
    'Takes about a minute. Card or bank transfer. Then Rapid Insulation will call you to book your install day.',
    'Install by Saturday 5 December. The rebate rules need your insulation in within 30 days of the safety check. The rest of your payment is due on install day.',
    'Electrical upgrades needed: None',
    "Your signed safety check (PIESA) is attached. Please keep it: the VEU program says you must have it at least 24 hours before your install. Please don't let anyone into the ceiling before the install, or the check may need to be done again.",
  ]) expect(m.text).toContain(s);
  expect(m.text).not.toMatch(/Stripe|to be confirmed|7 days after|Bank details|lawyer|HIV\b/);
  expect(m.html).toContain('Confirm and pay my deposit');
});
test('upgrades done on the day shows Done', () => {
  expect(renderInstallDepositOwnerEmail({ ...facts, upgrades: 'Done' }, 'request', true).text).toContain('Electrical upgrades needed: Done');
});
test('flag off (or reminders/paid) keeps the old wording', () => {
  const old = renderInstallDepositOwnerEmail(facts, 'request', false);
  expect(old.subject).toBe('Your 50% install deposit');
  expect(renderInstallDepositOwnerEmail(facts, 'day3', true).subject).toBe('Your install deposit reminder');
  expect(renderInstallDepositOwnerEmail(facts, 'paid', true).subject).toBe('Deposit received');
});
test('the flag is ON since go-live 5 Nov 2026: the request is the clear-to-install email; off = the old deposit ask', () => {
  expect(renderInstallDepositOwnerEmail(facts, 'request').subject).toBe("You're clear to install");
  expect(renderInstallDepositOwnerEmail(facts, 'request', false).subject).toBe('Your 50% install deposit');
});

const PDF = { filename: 'x.pdf', content: 'AA==', contentType: 'application/pdf' };
const deps = () => ({
  approved: true,
  route: async () => (routeClear ? ['clear_to_install' as const] : ['standalone_copy' as const]),
  inputs: async () => inputsOk ? { checkedOn: '2026-11-07', electrician: 'Viking Electrical', piesaRecordId: 'r', signedCopyId: 'c', attachments: [PDF, { ...PDF, filename: 'consent.pdf' }] } : { held: 'Clear to install documents not ready' },
  record: async (p: any) => { recorded.push(p); },
});
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.jobs = [{ id: 'j', job_number: 'HV-1234', source: 'website', stage: 'installation_scheduling', owner_id: 'o', property_id: 'p', deleted_at: null, qa_archived_at: null }];
  tables.owners = [{ id: 'o', full_name: 'Sarah Owner', email: 'owner@example.invalid', phone: '0412345678' }];
  tables.properties = [{ id: 'p', address_line: '1 Practice St', suburb: 'Melbourne', postcode: '3000' }];
  tables.businesses = [{ id: 'b', name: 'Practice Insulation', email: 'office@example.invalid', in_house: true }];
  tables.job_assignments = [{ id: 'a', job_id: 'j', business_id: 'b', user_id: 'u', role: 'installer', active: true }];
  tables.workflow_events = []; tables.customer_email_sends = []; tables.piesa_records = [{ id: 'r', job_id: 'j', is_current: true, created_at: '2026-11-01T00:00:00Z' }]; tables.piesa_deliveries = [];
  emails.length = texts.length = recorded.length = guards.length = 0; emailKeys.clear();
  paidNow = false; bookedNow = false; deadlineNow = '2026-12-05'; outcome = 'pass'; inputsOk = true; routeClear = true; paused = false; unsubscribed = false;
});
const at = new Date('2026-11-01T00:00:00Z');
test('flag on: one clear email, same key, both PDFs attached, owner deliveries recorded once', async () => {
  await requestInstallDeposit('j', at, deps()); await requestInstallDeposit('j', at, deps());
  expect(emails).toHaveLength(1);
  expect(emails[0].key).toBe('install-deposit:v1:i');
  expect(emails[0].mail.subject).toBe("You're clear to install");
  expect(emails[0].mail.attachments).toHaveLength(2);
  expect(emails[0].mail.text).toContain('screen=clear');
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ jobId: 'j', recipient: 'owner', piesaRecordId: 'r', signedCopyId: 'c', to: 'owner@example.invalid' });
});
test('compliance purpose: reaches an unsubscribed owner', async () => {
  expect(COMPLIANCE_OWNER_EMAIL_PURPOSES).toContain(emails[0]?.purpose ?? 'piesa_copy');
  unsubscribed = true;
  await requestInstallDeposit('j', at, deps());
  expect(emails[0].purpose).toBe('piesa_copy');
  expect(COMPLIANCE_OWNER_EMAIL_PURPOSES).toContain(emails[0].purpose);
});
test('upgrades done same day shows Done in the email', async () => {
  outcome = 'fail';
  await requestInstallDeposit('j', at, deps());
  expect(emails[0].mail.text).toContain('Electrical upgrades needed: Done');
});
test('PIESA or consent PDF missing: held, nothing sent, not recorded', async () => {
  inputsOk = false;
  const r = await requestInstallDeposit('j', at, deps());
  expect(r).toContain('Clear to install documents not ready');
  expect(emails).toHaveLength(0); expect(texts).toHaveLength(0); expect(recorded).toHaveLength(0);
});
test('flag off: old deposit request, no attachments, nothing recorded', async () => {
  await requestInstallDeposit('j', at, { ...deps(), approved: false });
  expect(emails).toHaveLength(1);
  expect(emails[0].mail.subject).toBe('Your 50% install deposit');
  expect(emails[0].purpose).toBe('install_deposit_request');
  expect(emails[0].mail.attachments).toBeUndefined();
  expect(recorded).toHaveLength(0);
});
test('route says standalone (upgrades still to come / do not contact): old deposit request, no recording', async () => {
  routeClear = false;
  await requestInstallDeposit('j', at, deps());
  expect(emails[0].mail.subject).toBe('Your 50% install deposit');
  expect(recorded).toHaveLength(0);
});

// Safety net (Jo ruling 3 Nov): when the clear email cannot go, the owner still gets the standalone PIESA copy after 24h.
const resultAt = '2026-11-01T00:00:00Z';
const hoursAfter = (h: number) => new Date(Date.parse(resultAt) + h * 3600_000);
const standaloneDeps = () => ({ route: async () => ['clear_to_install' as const], resultAt: async () => resultAt });
const ownerGets = async (h: number) => resolveOwnerStandalone('j', hoursAfter(h), recorded.length > 0, standaloneDeps());
const blocked: [string, () => void][] = [
  ['deposit already paid', () => { paidNow = true; }],
  ['install already booked', () => { bookedNow = true; }],
  ['no install deadline', () => { deadlineNow = null; }],
  ['documents held', () => { inputsOk = false; }],
];
for (const [name, block] of blocked) {
  test(`clear route but ${name}: no email, nothing yet within 24h, standalone copy after 24h`, async () => {
    block();
    await requestInstallDeposit('j', hoursAfter(1), deps()).catch(() => 'pending');
    expect(emails).toHaveLength(0); expect(recorded).toHaveLength(0);
    expect(await ownerGets(1)).toBe(false);
    expect(await ownerGets(23)).toBe(false);
    expect(await ownerGets(25)).toBe(true);
  });
}
test('stale request: the clear email still goes more than 24h after the request was recorded', async () => {
  inputsOk = false;
  await requestInstallDeposit('j', hoursAfter(1), deps()); // request recorded, documents not ready
  inputsOk = true;
  const r = await requestInstallDeposit('j', hoursAfter(30), deps()); // 29h later
  expect(r).not.toContain('stale');
  expect(emails).toHaveLength(1); expect(recorded).toHaveLength(1);
});
test('stale rule still holds the old (non-clear) deposit request', async () => {
  routeClear = false;
  await requestInstallDeposit('j', hoursAfter(1), { ...deps(), approved: false }).catch(() => 0);
  emails.length = 0; emailKeys.clear(); tables.customer_email_sends = [];
  expect(await requestInstallDeposit('j', hoursAfter(30), { ...deps(), approved: false })).toContain('stale notice held');
});
test('clear email sent and recorded: no standalone copy', async () => {
  await requestInstallDeposit('j', hoursAfter(1), deps());
  expect(recorded).toHaveLength(1);
  expect(await ownerGets(200)).toBe(false);
});
test('already-sent path records the owner delivery when the row is missing', async () => {
  await requestInstallDeposit('j', hoursAfter(1), deps());
  tables.customer_email_sends = [{ id: 's', job_id: 'j', idempotency_key: 'install-deposit:v1:i', status: 'sent' }];
  recorded.length = 0;
  const r = await requestInstallDeposit('j', hoursAfter(2), deps());
  expect(r).toContain('already sent');
  expect(recorded).toHaveLength(1);
  expect(recorded[0]).toMatchObject({ jobId: 'j', recipient: 'owner', piesaRecordId: 'r', signedCopyId: 'c' });
});
test('ownerStandaloneDue agrees with the resolver', () => {
  expect(ownerStandaloneDue({ route: ['clear_to_install'], resultAt, now: hoursAfter(25), ownerDelivered: false })).toBe(true);
});

test('upgrades route (email on): the old deposit request is not sent; the upgrades email carries the deposit', async () => {
  await requestInstallDeposit('j', at, { ...deps(), upgradesApproved: true, route: async () => ['upgrades_needed' as const] });
  expect(emails).toHaveLength(0); expect(texts).toHaveLength(0);
});
