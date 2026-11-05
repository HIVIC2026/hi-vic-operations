import { expect, test } from 'bun:test';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import * as compliance from '../src/lib/worker-compliance.core';
import { bookingWorkerBlocker } from '../src/lib/in-house-booking.core';

function gate() {
  let reads = 0;
  const db = { from() { reads++; throw new Error('compliance read unavailable'); } };
  const api: Record<string, (...args: unknown[]) => Promise<void>> = {};
  new Function('exports', 'require', ts.transpile(readFileSync('src/lib/people-on-file.server.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }))(api, (path: string) => {
    if (path === '@/integrations/supabase/client.server') return { supabaseAdmin: db };
    if (path === './workflow.server') return { WorkflowError: Error };
    if (path === './worker-compliance.core') return compliance;
    throw new Error(`Unexpected ${path}`);
  });
  return { api, reads: () => reads };
}
test('Ready Check never reads DOB or install credentials and cannot be blocked by them', async () => {
  const f = gate();
  await f.api.requirePeopleOnFileForBooking('job', 'ready_check', 'tom');
  expect(f.reads()).toBe(0);
});
test('installation keeps its fail-closed people checks', async () => {
  const f = gate();
  await expect(f.api.requirePeopleOnFileForBooking('job', 'installation', 'tom')).rejects.toThrow('compliance read unavailable');
  expect(f.reads()).toBe(1);
});
for (const workerRole of ['lead', 'crew']) test(`Ready Check picker permits ${workerRole} without CII, White Card or ESC registration; install Lead does not`, () => {
  const worker = { id: 'tom', name: 'Tom Lowe', phone: null, tradeRole: 'installer', workerRole, cleared: false, reason: 'Missing CII and White Card', escRegistered: false };
  expect(bookingWorkerBlocker('ready_check', worker)).toBeNull();
  expect(bookingWorkerBlocker('installation', worker)).not.toBeNull();
});