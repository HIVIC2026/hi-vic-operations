// No database tests or hosted calls: exact contracts and mock-only signing.
import { describe, expect, test } from 'bun:test';
import * as inst from '../src/lib/installer-onboarding.core';
import * as rec from '../src/lib/rec-onboarding.core';
import { activity48AgreementScheduleText, ACTIVITY48_AGREEMENT_SCHEDULE_VERSION } from '../src/lib/activity48-agreement-schedule.text';
import { performInstallerSign, signedData, type InstallerSignApp } from '../src/lib/installer-sign.core';
import { performRecSign, type RecSignApp } from '../src/lib/rec-sign.core';
const date = '2026-10-09T20:13:00Z';
const hash = (s: string) => new Bun.CryptoHasher('sha256').update(s).digest('hex');
const ia: InstallerSignApp = { id: 'isolated-inst', status: 'draft', data: { works_for_business: false, wants_hivic_leads: false, agreement_reviewed: true }, insurance_certificate_path: null, created_at: date, updated_at: date, test_mode: true, allow_incomplete_sign: true };
const rd: rec.RecData = { works_under_rec: false, contact_is_licensed_electrician: true, licence_number: 'SAMPLE123', services_all_confirmed: true, agreement_reviewed: true };
const ra: RecSignApp = { ...ia, id: 'isolated-rec', data: rd };
const it = inst.agreementText(signedData(ia));
const rt = rec.agreementText({ ...rd, insurance_uploaded: false });
const ii = { signer_name: 'Sample Installer', signer_position: 'Director', signer_email: 'sample@example.com', acknowledgements: Object.fromEntries(inst.ACKNOWLEDGEMENTS.map(a => [a.key, true])), agreement_version: inst.INSTALLER_AGREEMENT_VERSION, expected_updated_at: date, agreement_sha256: hash(it) };
const ri = { ...ii, acknowledgements: Object.fromEntries(rec.ACKNOWLEDGEMENTS.map(a => [a.key, true])), agreement_version: rec.REC_AGREEMENT_VERSION, agreement_sha256: hash(rt) };
const rules = [
 ['full CII and lead duties', 'full current EEC Certified Insulation Installer (CII)', 'provisional certification or training alone is insufficient', 'remain onsite for its entire duration', 'sign off the installer declarations in the VEEC assignment'],
 ['AP register and privacy', 'privacy collection notice before registration explaining disclosure to the ESC and EEC', 'registers the lead before installation notification and other installers before VEEC creation', 'obtains ESC verification before selecting individuals'],
 ['safe authorised work', 'completed job-specific SWMS', 'solar PV, batteries and generators', 'switchboard lockout and tagging', 'Only legally authorised persons may perform electrical work', 'remove lockouts and safely re-energise'],
 ['readiness timings', 'executed AP–consumer contract', 'no more than 30 days', 'both owner and Installer at least 24 hours', 'PIISA before work', 'consent at least 24 hours', 'at least 24 hours and no more than 5 days', 'BEFORE the PIESA starts', 'attached to the PIESA and received by the Installer', 'every PIISA item remains compliant at the start of each day'],
 ['installation and removal', 'at least R5.0', 'AS/NZS 4859.1', 'all eligible and practical ceiling spaces', 'every ceiling luminaire is IC or IC-4', 'metallic or conductive', 'unsuitable condition for overlay', 'overlay would fail AS 3999', 'record that advice', 'owner approval of scope and cost changes before chargeable work'],
 ['REC evidence', 'timestamped and geotagged photograph', 'front of the premises with photo ID', 'before the PIESA', 'TPS or equivalent', 'ONLY by a licensed electrical worker', 'signatures of the electrician and owner', 'CoES document describing that rectification, not just its number', 'photo ID before installation'],
 ['installer before evidence', 'photo ID of EACH EEC CII installer before installation', 'PIISA signed by the lead', 'EACH claimed upgrade zone', 'labelled, illuminated, timestamped and geotagged 360-degree', 'BEFORE installation', 'no larger than 250 MB', 'existing-insulation depth photographs using a vertical ruler', 'visible brand, model and R-value markings', 'tagged and locked switchboard', 'solar and battery isolators switched off', 'product packaging onsite showing brand, model and R-value'],
 ['installer after evidence', 'AFTER installation', 'new-insulation depth photographs using a vertical ruler', 'consistently named zones', 'dimensions, installed product, R-value and installed square metres per zone', 'accurate roof aerial', 'elevation photographs', 'balconies, verandahs, patios'],
 ['before-install documents', 'VEET Scheme Consumer Factsheet', 'rights and obligations, suitability, contract terms and installer contacts', 'PIESA and the CoES where rectification occurred'],
 ['completion documents and claim support', 'valid tax invoice', 'at signing for written assignment, within 10 business days for electronic assignment', 'dispute-resolution information, manufacturer instructions, AP and installer contacts', 'minimum five-year product warranty-against-defects document', 'at completion and provides reasonable claim support', 'Australian warranty contact where the warrantor is overseas', 'separate twelve-month workmanship warranty'],
 ['invoice identity and particulars', 'consumer name and address', 'actual contracting business name, address and ABN', 'brand, model and R-value', 'total installed area', 'price before the VEEC incentive', 'VEEC incentive amount', 'amount paid after the incentive', 'invoice date', 'Reconcile bulk invoices per premises', 'identify the AP in that capacity, not the Installer'],
 ['retention and AP duties', 'no less than six years after the relevant VEEC registration', 'record-made or transaction-completed minimum where independently applicable', 'Do not destroy supporting records while registration is pending or an audit is unresolved', 'does not transfer those duties to a trade'],
] as const;
describe('complete applicant contracts', () => {
 for (const [name, text] of [['Installer', it], ['REC', rt]]) {
  for (const [rule, ...requirements] of rules) test(`${name}: ${rule}`, () => { for (const requirement of requirements) expect(text).toContain(requirement); });
  test(`${name}: schedule incorporated exactly once before acknowledgements`, () => { const s = activity48AgreementScheduleText(); expect(text.split(s)).toHaveLength(2); expect(text.indexOf(s)).toBeLessThan(text.indexOf('ACKNOWLEDGEMENTS')); expect(text).toContain(`Schedule version: ${ACTIVITY48_AGREEMENT_SCHEDULE_VERSION}`); });
 }
 test('versions retain prior signatures and reject prior REC review', () => {
  expect(inst.INSTALLER_AGREEMENT_VERSION).toBe('HI-VIC-A48-INST-1.19-2026-10-09'); expect(rec.REC_AGREEMENT_VERSION).toBe('HI-VIC-A48-REC-2.6-2026-10-09');
  expect(inst.ACTIVATABLE_INSTALLER_VERSIONS).toContain('HI-VIC-A48-INST-1.18-2026-10-09'); expect(rec.ACTIVATABLE_REC_VERSIONS).toContain('HI-VIC-A48-REC-2.5-2026-10-05');
  expect(rec.recReviewGateOpen({ agreement_reviewed: true }, { version: 'HI-VIC-A48-REC-2.5-2026-10-05', sha256: hash(rt) })).toBe(false);
 });
 test('review schedules and acknowledgements include Schedule 4', () => {
  for (const text of [inst.scheduleText({}), rec.scheduleText({})]) expect(text).toContain(activity48AgreementScheduleText());
  for (const acks of [inst.ACKNOWLEDGEMENTS, rec.ACKNOWLEDGEMENTS]) expect(acks.find(a => a.key === 'schedule')?.text).toContain('AP retains its own statutory duties');
 });
});
describe('mock-only signatures and history', () => {
 test('both signatures bind complete text, schedule, version, hash and acknowledgement', async () => {
  let is: Record<string, unknown> | undefined, rs: Record<string, unknown> | undefined;
  await performInstallerSign(ia, ii, { ip: null, userAgent: null }, { sha256: async s => hash(s), signAtomic: async a => { is = a.signed; return { outcome: 'signed', partner_enquiry_id: 'sample', signed_at: date }; } });
  await performRecSign(ra, ri, { ip: null, userAgent: null }, { sha256: async s => hash(s), signAtomic: async a => { rs = a.signed; return { outcome: 'signed', partner_enquiry_id: 'sample', signed_at: date }; } }, new Date(date));
  expect(is).toMatchObject({ agreement_text: it, agreement_version: inst.INSTALLER_AGREEMENT_VERSION, agreement_sha256: hash(it), acknowledgements: { schedule: { accepted: true } } });
  expect(rs).toMatchObject({ agreement_text: rt, agreement_version: rec.REC_AGREEMENT_VERSION, agreement_sha256: hash(rt), acknowledgements: { schedule: { accepted: true } } });
 });
 test('old versions, stale hashes and missing schedule acknowledgement make zero persistence calls', async () => {
  let calls = 0; const deps = { sha256: async (s: string) => hash(s), signAtomic: async () => { calls++; throw new Error('Unexpected persistence'); } };
  for (const i of [{ ...ri, agreement_version: 'HI-VIC-A48-REC-2.5-2026-10-05' }, { ...ri, agreement_sha256: hash('previous schedule') }, { ...ri, acknowledgements: { ...ri.acknowledgements, schedule: false } }]) await expect(performRecSign(ra, i, { ip: null, userAgent: null }, deps, new Date(date))).rejects.toThrow();
  for (const i of [{ ...ii, agreement_version: 'HI-VIC-A48-INST-1.18-2026-10-09' }, { ...ii, agreement_sha256: hash('previous schedule') }, { ...ii, acknowledgements: { ...ii.acknowledgements, schedule: false } }]) await expect(performInstallerSign(ia, i, { ip: null, userAgent: null }, deps)).rejects.toThrow();
  expect(calls).toBe(0);
 });
 test('historic REC replay never regenerates or replaces signed text', async () => {
  const h = hash('historic exact REC agreement'); let payload: Record<string, unknown> | undefined;
  await performRecSign({ ...ra, status: 'submitted', agreement_sha256: h, partner_enquiry_id: 'historic' }, { ...ri, agreement_version: 'HI-VIC-A48-REC-2.5-2026-10-05', agreement_sha256: h }, { ip: null, userAgent: null }, { sha256: async () => { throw new Error('Must not regenerate'); }, signAtomic: async a => { payload = a; return { outcome: 'already_signed_same', partner_enquiry_id: 'historic', signed_at: date }; } });
  expect(payload?.signed).toEqual({}); expect(payload?.enquiry).toEqual({});
 });
});
