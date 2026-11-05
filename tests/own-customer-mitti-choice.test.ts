import { expect, test } from 'bun:test';
import { ownCustomerMittiAllowed } from '../src/lib/own-customer-mitti-choice.core';
test('adding own job never authorises A1', () => {
  expect(ownCustomerMittiAllowed({channel:'installer_sourced',requested:false,portalSaved:false})).toBe(false);
});
test('on-site tap authorises own A1', () => {
  expect(ownCustomerMittiAllowed({channel:'installer_sourced',requested:true,portalSaved:false})).toBe(true);
});
test.each([true,false])('portal path excludes A1 even requested=%p', requested => {
  expect(ownCustomerMittiAllowed({channel:'installer_sourced',requested,portalSaved:true})).toBe(false);
});
test('lead does not require own-customer tap', () => {
  expect(ownCustomerMittiAllowed({channel:'hivic_sourced',requested:false,portalSaved:false})).toBe(true);
});