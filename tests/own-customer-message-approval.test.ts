import { expect, test } from 'bun:test';
import { OWN_CUSTOMER_MESSAGE_KEYS, ownMessageApproved, ownMessageSwitch, ownQuoteMessageKey } from '../src/lib/own-customer-message-approval.core';
import { withSmsSwitch } from '../src/lib/office-settings.core';
test('all five own-customer emails default OFF, independently of existing owner approvals', () => {
  for (const key of OWN_CUSTOMER_MESSAGE_KEYS) expect(ownMessageApproved({ quote_ready: true }, key)).toBe(false);
});
test('approving first owner quote does not approve updated quote or any installer notice', () => {
  const map = withSmsSwitch({ job_offer: true }, ownMessageSwitch('own_owner_quote'), true);
  expect(ownMessageApproved(map, 'own_owner_quote')).toBe(true);
  for (const key of OWN_CUSTOMER_MESSAGE_KEYS.filter(k => k !== 'own_owner_quote')) expect(ownMessageApproved(map, key)).toBe(false);
  expect(map.job_offer).toBe(true);
});
test('replacement release requires its own approval, not first-quote approval', () => {
  expect(ownQuoteMessageKey(false)).toBe('own_owner_quote');
  expect(ownQuoteMessageKey(true)).toBe('own_owner_updated_quote');
  expect(ownMessageApproved({ [ownMessageSwitch('own_owner_quote')]: true }, ownQuoteMessageKey(true))).toBe(false);
});
test('unreadable or nonboolean approval never enables delivery', () => {
  for (const value of [null, [], 'on', { [ownMessageSwitch('own_owner_quote')]: 'true' }]) expect(ownMessageApproved(value, 'own_owner_quote')).toBe(false);
});