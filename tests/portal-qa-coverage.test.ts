import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { uiRouteInventory, uncoveredReason, readyCheckBookingOutcome, READ_ONLY_PATHS, completedRouteCoverage, normalizedRouteFamily } from '../scripts/portal-qa-coverage';
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
test('actual parameterized destination counts only with loaded content, correct role and viewport', () => {
  const routes = uiRouteInventory(readFileSync('src/routeTree.gen.ts', 'utf8'));
  const row = { requested_path: '/admin/jobs/518271f4-90b5-4d16-8ccc-2d2a5a0a12c1', landed_path: '/admin/jobs/518271f4-90b5-4d16-8ccc-2d2a5a0a12c1', persona: 'office', ok: true, content_verified: true, viewport: { width: 1280, height: 1800 } };
  expect(normalizedRouteFamily(row.landed_path, routes)).toBe('/admin/jobs/$jobId');
  const status = (rows: typeof row[]) => completedRouteCoverage(routes, rows).find(r => r.path === '/admin/jobs/$jobId' && r.viewport.width === 1280)?.status;
  expect(status([row])).toBe('PASS');
  expect(status([{ ...row, content_verified: false }])).toBe('NOT_RUN');
  expect(status([{ ...row, persona: 'installer' }])).toBe('NOT_RUN');
  expect(status([{ ...row, landed_path: '/auth' }])).toBe('NOT_RUN');
  expect(status([])).toBe('NOT_RUN');
  expect(completedRouteCoverage(routes, [row]).find(r => r.path === '/admin/jobs/$jobId' && r.viewport.width === 390)?.status).toBe('NOT_RUN');
});
test('Gate A hold is NOT_RUN, never a completed Ready Check', () => {
  expect(readyCheckBookingOutcome(false, { stage: 'ready_check_ready_to_schedule' }, 'paperwork A')).toEqual({ status: 'not_run', detail: 'booking not completed: paperwork A' });
});
test('booking PASS requires persisted windows in addition to scheduled state read back', () => {
  expect(readyCheckBookingOutcome(true, { stage: 'ready_check_scheduled', next_action: 'Ready Check booked' }).status).toBe('not_run');
  expect(readyCheckBookingOutcome(true, { stage: 'ready_check_scheduled', next_action: 'Ready Check booked' }, undefined, { verified: true, detail: 'checked window readback' }).status).toBe('passed');
  expect(readyCheckBookingOutcome(true, { stage: 'ready_check_scheduled', next_action: 'Ready Check booked' }, undefined, { verified: false, detail: 'windows_not_saved' }).status).toBe('failed');
  expect(readyCheckBookingOutcome(true, { stage: 'ready_check_ready_to_schedule' }).status).toBe('failed');
  expect(readyCheckBookingOutcome(true, null).status).toBe('failed');
});