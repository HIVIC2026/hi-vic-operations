import { beforeEach, expect, mock, test } from 'bun:test';
import { memoryPostgrest, type Tables } from './helpers/memory-postgrest';
// Part 4 Task 6: deposit reminders (#43), Deposit received (#44), deposit-in office email (#45). Wording + the sends.
const tables: Tables = {}; const admin = memoryPostgrest(tables);
let paidNow = false, upgradesToCome = false, paidInputsHeld: string | null = null, receiptOn = true;
const emails: any[] = [], texts: any[] = [], officeMails: any[] = [], testMails: any[] = [];
const emailKeys = new Set<string>();
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: admin }));
mock.module('../src/lib/in-house-suppression.server', () => ({ readInHouseDispatchState: async () => ({ failed: false, held: new Set(['j']) }) }));
mock.module('../src/lib/allocation.server', () => ({ clearanceFacts: async () => ({ piesaOutcome: 'fail' }) }));
mock.module('../src/lib/install-days.server', () => ({ installDayContext: async () => ({ clearance: { cleared: true, basis: 'initial_piesa' }, deadline: '2026-12-06', booked: false }) }));
mock.module('../src/lib/payments.server', () => ({ jobPaymentView: async () => ({ invoiceId: 'i', invoices: { install: { id: 'i', xero_invoice_id: 'x' } }, plan: { installDepositCents: 15700, balanceCents: 141200 }, steps: [{ key: 'install_deposit', state: paidNow ? 'paid' : 'due', outstandingCents: paidNow ? 0 : 15700 }], bank: { configured: true, accountName: 'P', bsb: '123456', accountNumber: '12345678' }, reference: 'INV-1', stripe: { available: true } }) }));
mock.module('../src/lib/veec-copy-email.server', () => ({ ownerMyJobLink: async () => 'https://example.invalid/my-job/token' }));
mock.module('../src/lib/comms.server', () => ({ assertCustomerDeliveryAllowed: async () => {} }));
mock.module('../src/lib/trade-pause.server', () => ({ tradeMessagesPausedNow: async () => false }));
mock.module('../src/lib/qa-inbox.server', () => ({ qaDeliveryHeld: async () => false }));
mock.module('../src/lib/office-email.server', () => ({ sendOfficeEmail: async (p: any) => { officeMails.push(p); return { status: 'sent' }; } }));
mock.module('../src/lib/owner-email-send.server', () => ({ sendGuardedOwnerEmail: async (p: any) => { if (emailKeys.has(p.key)) return 'already attempted'; emailKeys.add(p.key); emails.push({ ...p, mail: p.build(null) }); return 'sent'; } }));
mock.module('../src/lib/sms.server', () => ({ sendRealSms: async (p: any) => { texts.push(p); return { status: 'sent' }; } }));
const core = await import('../src/lib/deposit-request-email.core');
const { renderInstallDepositOwnerEmail, renderInstallerDepositPaidEmail, DEPOSIT_MESSAGES_V2_APPROVED } = core;
const { pickDepositReceiptKey } = await import('../src/lib/deposit-paid-inputs.core');
const { notifyInstallerDepositPaid, sweepDepositRequests } = await import('../src/lib/deposit-request.server');

const facts = { name: 'Sarah', firstName: 'Sarah', installer: 'Rapid Insulation', jobNumber: 'HV-1234', address: '1 A St, Melbourne', ownerPhone: '0412 345 678', deadline: '2026-12-06', amountCents: 15700, link: 'https://example.invalid/my-job/t?screen=pay', bank: { configured: true, accountName: 'P', bsb: '1', accountNumber: '2' }, reference: 'R', card: true, officePhone: '03 9000 0000', balanceCents: 141200, ownerFullName: 'Sarah Owner', bookUrl: 'https://example.invalid/field/j' };

test('flag is off by default', () => { expect(DEPOSIT_MESSAGES_V2_APPROVED).toBe(false); });
test('flag off keeps the current wording', () => {
  expect(renderInstallDepositOwnerEmail(facts, 'day3', false).subject).toBe('Your install deposit reminder');
  expect(renderInstallDepositOwnerEmail(facts, 'paid', false).subject).toBe('Deposit received');
  expect(renderInstallerDepositPaidEmail(facts, false).subject).toBe('HV-1234: deposit paid');
});
for (const step of ['day3', 'day7'] as const) test(`#43 reminder ${step}`, () => {
  const m = renderInstallDepositOwnerEmail(facts, step, false, true);
  expect(m.subject).toBe('Reminder: one last step to book your install');
  for (const s of [
    "You're clear to install. Confirm your safety check and pay your deposit, then Rapid Insulation will call you to book your install day. It takes about a minute.",
    '$157.00', 'Confirm and pay my deposit: https://example.invalid/my-job/t?screen=clear', 'Card or bank transfer.', 'Install by Sunday 6 December', 'The rest of your payment is due on install day.',
  ]) expect(m.text).toContain(s);
  expect(m.text).not.toMatch(/Bank details: we'll send these|\(Stripe\)|lawyer|HIV\b/);
  expect(m.html).toContain('Confirm and pay my deposit');
  expect(m.html).toContain('screen=clear');
});
test('#43 upgrades still to come: opening sentence dropped, rest kept', () => {
  const m = renderInstallDepositOwnerEmail({ ...facts, upgradesToCome: true }, 'day3', false, true);
  expect(m.text).not.toContain("You're clear to install.");
  expect(m.text).toContain('Confirm your safety check and pay your deposit, then Rapid Insulation will call you to book your install day. It takes about a minute.');
  expect(m.text).toContain('Card or bank transfer.');
});
test('#44 Deposit received wording', () => {
  const m = renderInstallDepositOwnerEmail(facts, 'paid', false, true, { receiptAttached: true });
  expect(m.subject).toBe('Deposit received, thanks!');
  for (const s of ["We've got your $157.00 deposit. Rapid Insulation will call you from 03 9000 0000 to book your install day.", 'Install by Sunday 6 December (30-day rule).', 'The rest of your payment, $1,412.00, is due on install day.', 'Your receipt is attached.']) expect(m.text).toContain(s);
  expect(m.text).not.toMatch(/lawyer|HIV\b/);
});
test('#44 no receipt attached: no receipt line', () => {
  expect(renderInstallDepositOwnerEmail(facts, 'paid', false, true, { receiptAttached: false }).text).not.toContain('Your receipt is attached.');
});
test('#44 deposit amount is the plan deposit, not the outstanding', () => {
  expect(renderInstallDepositOwnerEmail({ ...facts, amountCents: 0, depositCents: 15700 }, 'paid', false, true).text).toContain('$157.00 deposit');
});
test('#45 office email', () => {
  const m = renderInstallerDepositPaidEmail(facts, true);
  expect(m.subject).toBe('HV-1234: deposit in, ready to book');
  for (const s of ["Good news: Sarah's deposit is in 🎉", 'HV-1234 is ready to book. Give Sarah a call, agree the install day, then add it and your Lead Installer on the job.', 'Owner', 'Sarah Owner', 'Phone', '0412 345 678', 'Address', '1 A St, Melbourne', 'Install by', 'Sunday 6 December', 'Sarah pays the rest on install day.', 'Book the install: https://example.invalid/field/j']) expect(m.text).toContain(s);
  expect(m.html).toContain('Book the install');
  expect(m.html).toContain('Sarah Owner');
});

test('receipt key: exactly one un-reversed deposit payment', () => {
  const r = { receipt_key: 'k1', amount_cents: 15700 };
  expect(pickDepositReceiptKey({ recorded: [r], reversed: [], depositCents: 15700 })).toBe('k1');
  expect(pickDepositReceiptKey({ recorded: [r, { ...r, receipt_key: 'k2' }], reversed: [], depositCents: 15700 })).toBeNull();
  expect(pickDepositReceiptKey({ recorded: [r], reversed: [{ stripe_payment_intent: 'p' }], depositCents: 15700 })).toBe('k1');
  expect(pickDepositReceiptKey({ recorded: [{ ...r, stripe_payment_intent: 'p' }], reversed: [{ stripe_payment_intent: 'p' }], depositCents: 15700 })).toBeNull();
  expect(pickDepositReceiptKey({ recorded: [{ receipt_key: 'x', amount_cents: 34900 }], reversed: [], depositCents: 15700 })).toBeNull();
});

const PDF = (filename: string) => ({ filename, content: 'AA==', contentType: 'application/pdf' });
const deps = (v2: boolean) => ({
  approved: false, v2,
  route: async () => (upgradesToCome ? ['upgrades_needed' as const] : ['standalone_copy' as const]),
  inputs: async () => ({ held: 'n/a' }),
  record: async () => {},
  paid: async () => (paidInputsHeld ? { held: paidInputsHeld } : { officePhone: '03 9000 0000', balanceCents: 141200, depositCents: 15700, attachments: receiptOn ? [PDF('Receipt.pdf'), PDF('PIESA.pdf')] : [PDF('PIESA.pdf')], receiptAttached: receiptOn }),
});
beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.jobs = [{ id: 'j', job_number: 'HV-1234', source: 'website', stage: 'installation_scheduling', owner_id: 'o', property_id: 'p', deleted_at: null, qa_archived_at: null }];
  tables.owners = [{ id: 'o', full_name: 'Sarah Owner', email: 'owner@example.invalid', phone: '0412345678' }];
  tables.properties = [{ id: 'p', address_line: '1 Practice St', suburb: 'Melbourne', postcode: '3000' }];
  tables.businesses = [{ id: 'b', name: 'Practice Insulation', email: 'office@example.invalid', in_house: true }];
  tables.job_assignments = [{ id: 'a', job_id: 'j', business_id: 'b', user_id: 'u', role: 'installer', active: true }];
  tables.workflow_events = [{ id: 'e1', job_id: 'j', event_type: 'install_deposit_received', created_at: '2026-11-01T00:00:00Z', details: { invoice_id: 'i' } }, { id: 'e2', job_id: 'j', event_type: 'install_deposit_requested', created_at: '2026-10-27T00:00:00Z', details: { invoice_id: 'i' } }];
  tables.customer_email_sends = [];
  emails.length = texts.length = officeMails.length = 0; emailKeys.clear();
  paidNow = true; upgradesToCome = false; paidInputsHeld = null; receiptOn = true;
});
const at = new Date('2026-11-01T01:00:00Z'); // 11:00 Melbourne
test('paid, flag on: owner email has receipt + PIESA only (no consent PDF), no text; office email new wording', async () => {
  const r = await notifyInstallerDepositPaid('j', at, deps(true));
  expect(r).toContain('installer sent');
  expect(emails).toHaveLength(1);
  expect(emails[0].purpose).toBe('install_deposit_paid');
  expect(emails[0].mail.subject).toBe('Deposit received, thanks!');
  expect(emails[0].mail.attachments.map((a: any) => a.filename)).toEqual(['Receipt.pdf', 'PIESA.pdf']);
  expect(emails[0].mail.text).toContain('Your receipt is attached.');
  expect(texts).toHaveLength(0);
  expect(officeMails[0].subject).toBe('HV-1234: deposit in, ready to book');
});
test('paid, flag on, receipts not approved: sent without the receipt line', async () => {
  receiptOn = false;
  await notifyInstallerDepositPaid('j', at, deps(true));
  expect(emails[0].mail.attachments.map((a: any) => a.filename)).toEqual(['PIESA.pdf']);
  expect(emails[0].mail.text).not.toContain('receipt is attached');
});
test('paid, flag on, office phone missing: owner email held with a note, office email still goes', async () => {
  paidInputsHeld = 'Installer office phone not on file';
  const r = await notifyInstallerDepositPaid('j', at, deps(true));
  expect(r).toContain('Installer office phone not on file');
  expect(emails).toHaveLength(0);
  expect(officeMails).toHaveLength(1);
});
test('paid, flag off: old wording, no attachments, old office email', async () => {
  await notifyInstallerDepositPaid('j', at, deps(false));
  expect(emails[0].mail.subject).toBe('Deposit received');
  expect(emails[0].mail.attachments).toBeUndefined();
  expect(officeMails[0].subject).toBe('HV-1234: deposit paid');
});
test('consent copy is never attached by Deposit received, in any order', async () => {
  await notifyInstallerDepositPaid('j', at, deps(true));
  expect(JSON.stringify(emails[0].mail.attachments)).not.toMatch(/consent/i);
  expect(emails[0].purpose).not.toBe('esc_consent_copy');
});
test('reminder (flag on) for a job with upgrades to come drops the opening sentence', async () => {
  paidNow = false; upgradesToCome = true;
  tables.workflow_events = [{ id: 'e2', job_id: 'j', event_type: 'install_deposit_requested', created_at: '2026-10-28T00:00:00Z', details: { invoice_id: 'i' } }];
  await sweepDepositRequests(at, deps(true));
  expect(emails).toHaveLength(1);
  expect(emails[0].mail.subject).toBe('Reminder: one last step to book your install');
  expect(emails[0].mail.text).not.toContain("You're clear to install.");
  expect(emails[0].mail.text).toContain('screen=clear');
  expect(emails[0].key).toBe('install-deposit-day3:v1:i');
});
test('reminder (flag off) keeps the current wording', async () => {
  paidNow = false;
  tables.workflow_events = [{ id: 'e2', job_id: 'j', event_type: 'install_deposit_requested', created_at: '2026-10-28T00:00:00Z', details: { invoice_id: 'i' } }];
  await sweepDepositRequests(at, deps(false));
  expect(emails[0].mail.subject).toBe('Your install deposit reminder');
});
