import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { uiRouteInventory, uncoveredReason, readyCheckBookingOutcome, READ_ONLY_PATHS } from '../scripts/portal-qa-coverage';
test('UI checklist covers generated content families without APIs and deduplicates index aliases', () => {
  const rows = uiRouteInventory(readFileSync('src/routeTree.gen.ts', 'utf8'));
  expect(rows.some(r => r.path === '/admin/jobs/$jobId')).toBe(true);
  expect(rows.some(r => r.path === '/field/business/rates')).toBe(true);
  expect(rows.some(r => r.path === '/calculator')).toBe(true);
  expect(rows.some(r => r.path.startsWith('/api/'))).toBe(false);
  expect(new Set(rows.map(r => r.path)).size).toBe(rows.length);
  expect(READ_ONLY_PATHS.every(p => rows.some(r => r.path === p))).toBe(true);
});
test('missing route fixture or unvisited page never means PASS', () => {
  expect(uncoveredReason({ path: '/times/$token', persona: 'public', fixture: 'TEST token required' }, new Set())).toBe('TEST token required');
  expect(uncoveredReason({ path: '/admin/money', persona: 'office', fixture: null }, new Set())).toContain('not visited');
});
test('Gate A hold is NOT_RUN, never a completed Ready Check', () => {
  expect(readyCheckBookingOutcome(false, { stage: 'ready_check_ready_to_schedule' }, 'paperwork A')).toEqual({ status: 'not_run', detail: 'booking not completed: paperwork A' });
});
test('booking PASS requires concrete scheduled state read back', () => {
  expect(readyCheckBookingOutcome(true, { stage: 'ready_check_scheduled', next_action: 'Ready Check booked' }).status).toBe('passed');
  expect(readyCheckBookingOutcome(true, { stage: 'ready_check_ready_to_schedule' }).status).toBe('failed');
  expect(readyCheckBookingOutcome(true, null).status).toBe('failed');
});