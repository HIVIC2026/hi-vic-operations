import { expect, test } from 'bun:test';
import { buildConsentFacts, consentStaleReasons, consentValidityBlockers, ownerConsentBlockers, ESC_CONSENT_TEMPLATE_VERSION, OWNER_DECLARATIONS } from '../src/lib/consent.core';
import { resolveOwnerScreen } from '../src/lib/owner-myjob.core';
import { quoteSittingBlockers, OWNER_EMAIL_DOCUMENT_CONSENT } from '../src/lib/owner-quote-sign.core';
import { RETIRED_DOC_KEYS, piesaCopyReceiptBlocker } from '../src/lib/owner-gates.core';
const owner = { name: 'Jo Owner', email: 'owner@example.invalid', phone: '0400000000' };
const declarations = Object.fromEntries(OWNER_DECLARATIONS.map(d => [d.key, true]));
test('quote-stage consent needs no booked date and has no date fields', () => {
 const f = buildConsentFacts({ scheduledStart: null, scheduledEnd: null, premisesAddress: '1 TEST Street', owner });
 expect(f).not.toBeNull(); expect(f).not.toHaveProperty('scheduled_start'); expect(f).not.toHaveProperty('installation_days');
});
test('moving an installation does not stale the five-field consent', () => {
 const a = buildConsentFacts({ scheduledStart: '2026-11-10T00:00:00Z', scheduledEnd: null, premisesAddress: '1 TEST Street', owner });
 const b = buildConsentFacts({ scheduledStart: '2026-11-12T00:00:00Z', scheduledEnd: null, premisesAddress: '1 TEST Street', owner });
 if (!a || !b) throw new Error('Missing facts'); expect(consentStaleReasons(a,b)).toEqual([]);
});
test('all four declarations allow signing before booking', () => {
 expect(ownerConsentBlockers({ status:'awaiting_owner', templateApproved:true, templateVersion:ESC_CONSENT_TEMPLATE_VERSION, scheduledStart:null, nowIso:'2026-11-01T00:00:00Z', input:{signatoryName:owner.name,signatureName:owner.name,authorityType:'owner',accept:true,declarations} })).toEqual([]);
});
for (const d of OWNER_DECLARATIONS) test(`quote sitting refuses missing ${d.key}`, () => {
 expect(quoteSittingBlockers({ ownerTick:true, declarations:{...declarations,[d.key]:false} })).toHaveLength(1);
});
test('quote sitting refuses the missing owner tick', () => expect(quoteSittingBlockers({ownerTick:false,declarations})).toHaveLength(1));
test('date-free consent still requires BOTH signatures 24 hours before installation', () => {
 const c={status:'valid', scheduled_start:null, owner_signed_at:'2026-11-01T00:00:00Z',ap_signed_at:'2026-11-01T01:00:00Z'};
 expect(consentValidityBlockers(c,'2026-11-02T01:00:00Z')).toEqual([]);
 expect(consentValidityBlockers(c,'2026-11-02T00:59:59Z')).toHaveLength(1);
 expect(consentValidityBlockers({...c,ap_signed_at:null},'2026-11-05T00:00:00Z')).toHaveLength(1);
});
test('no screen and home resolve the current action rather than overview', () => {
 expect(resolveOwnerScreen(undefined,{currentAction:'quote'})).toBe('quote'); expect(resolveOwnerScreen('home',{currentAction:'pay'})).toBe('pay'); expect(resolveOwnerScreen('home',{})).toBe('all_set');
});
test('PIESA copy receipt is retired', () => {expect(RETIRED_DOC_KEYS.has('piesa_copy_receipt')).toBe(true);expect(piesaCopyReceiptBlocker({} as never)).toBeNull();});