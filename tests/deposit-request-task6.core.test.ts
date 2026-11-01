import { expect, test } from 'bun:test';
import { depositReminderDue, installDepositRequestKey, depositRequestEligible } from '../src/lib/deposit-request.core';
import { shouldFlagTenDaysLeft } from '../src/lib/install-days.core';
const requestedAt = '2026-11-01T00:00:00Z';
test('deposit request uses the existing installation invoice once', () => {
  expect(installDepositRequestKey('invoice-1')).toBe('install-deposit:v1:invoice-1');
});
test('PIESA pass enables deposit request', () => {
  expect(depositRequestEligible({ cleared:true, basis:'piesa_pass', paid:false, booked:false, deadline:'2026-11-30', now:new Date(requestedAt) })).toBe(true);
});
test('rectification needed or electrician at install start cannot request deposit', () => {
  expect(depositRequestEligible({ cleared:false, basis:null, paid:false, booked:false, deadline:'2026-11-30', now:new Date(requestedAt) })).toBe(false);
  expect(depositRequestEligible({ cleared:true, basis:'electrician_at_start', paid:false, booked:false, deadline:'2026-11-30', now:new Date(requestedAt) })).toBe(false);
});
test('completed rectification with Section C enables deposit', () => {
  expect(depositRequestEligible({ cleared:true, basis:'section_c', paid:false, booked:false, deadline:'2026-11-30', now:new Date(requestedAt) })).toBe(true);
});
test('day 3 reminder and not before', () => {
  expect(depositReminderDue({requestedAt,paid:false,now:new Date('2026-11-03T00:00:00Z')})).toBeNull();
  expect(depositReminderDue({requestedAt,paid:false,now:new Date('2026-11-04T00:00:00Z')})).toBe('day3');
});
test('day 7 supersedes missed day 3', () => {
  expect(depositReminderDue({requestedAt,paid:false,now:new Date('2026-11-08T00:00:00Z')})).toBe('day7');
});
test('no reminder once paid or without a recorded request', () => {
  expect(depositReminderDue({requestedAt,paid:true,now:new Date('2026-11-08T00:00:00Z')})).toBeNull();
  expect(depositReminderDue({requestedAt:null,paid:false,now:new Date('2026-11-08T00:00:00Z')})).toBeNull();
});
test('existing office flag is raised at ten days left, not eleven', () => {
  expect(shouldFlagTenDaysLeft({deadline:'2026-11-30',booked:false,flaggedAt:null,now:new Date('2026-11-20T00:00:00Z')})).toBe(true);
  expect(shouldFlagTenDaysLeft({deadline:'2026-11-30',booked:false,flaggedAt:null,now:new Date('2026-11-19T00:00:00Z')})).toBe(false);
});