import { expect, test } from 'bun:test';
import { installerMoneyReceipts } from '../src/lib/installer-money-receipts.core';
const record = (id: string, amountCents: number, paidAt: string) => ({ id, amountCents, paidAt, source: 'manual' as const });
test('10% installation deposit has its recorded date, safety-check payment alone does not count', () => {
  const input = { totalIncGst: 3349, totalPaid: 349, safetyCents: 34900, records: [record('safety', 34900, '2026-11-05T00:00:00Z')] };
  expect(installerMoneyReceipts(input).depositPaidAt).toBeNull();
  expect(installerMoneyReceipts({ ...input, records: [...input.records, record('deposit', 30000, '2026-11-06T00:00:00Z')] }).depositPaidAt).toBe('2026-11-06T00:00:00Z');
});
test('balance date is the recorded payment crossing the full installation invoice amount', () => {
  const result = installerMoneyReceipts({ totalIncGst: 3349, totalPaid: null, safetyCents: 34900, records: [record('deposit', 64900, '2026-11-06T00:00:00Z'), record('balance', 270000, '2026-11-07T00:00:00Z')] });
  expect(result.balancePaidAt).toBe('2026-11-07T00:00:00Z');
});
test('undated mirrored full payment never invents receipt dates', () => {
  expect(installerMoneyReceipts({ totalIncGst: 3349, totalPaid: 3349, safetyCents: 34900, records: [] })).toEqual({ depositPaid: true, depositPaidAt: null, balancePaidAt: null });
});