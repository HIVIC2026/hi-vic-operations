import { expect, test } from 'bun:test';
import { isReadyCheckQuote } from '../src/lib/installer-quote-status.core';
test('portal-submitted own-customer thicker quote remains available for installer status', () => {
  expect(isReadyCheckQuote('INSTALLER_A1_THICKER', { external_source: 'portal_ready_check', external_id: null })).toBe(true);
  expect(isReadyCheckQuote('UNRELATED', { external_source: 'portal_ready_check', external_id: null })).toBe(false);
});