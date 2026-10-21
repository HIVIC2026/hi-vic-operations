import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register({ url: 'http://localhost' });
import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DocItem } from '../src/lib/jobfile.core';
const { act, cleanup, fireEvent, render, waitFor } = await import('@testing-library/react');
let calls = 0;
let version = '1';
const documentRow = (): DocItem => ({ id: 'qa:document', title: 'Synthetic document', category: 'Property', alsoIn: [], subcategory: null, docType: 'pdf', sourceSystem: 'qa', at: null, actor: null, version, status: 'current', immutable: false, verifiedBy: null, verifiedAt: null, fileName: null, storagePath: null, sizeBytes: null, relatedEntity: 'job', relatedId: 'qa-job', sha256: null, sourceUrl: null, audience: [], internal: false });
mock.module('@tanstack/react-start', () => ({ useServerFn: (fn: unknown) => fn }));
mock.module('../src/lib/jobfile.functions', () => ({ getJobFile: async () => { calls++; return { documents: [documentRow()] }; }, openJobDocument: async () => ({}), getJobFileHeader: async () => ({}), exportJobPackFn: async () => ({}), logCommunication: async () => ({}) }));
mock.module('../src/hooks/use-me', () => ({ useAction: (fn: unknown) => fn }));
mock.module('../src/lib/nextstep.core', () => ({ nextStep: () => ({ next: '' }) }));
mock.module('../src/lib/workflow', () => ({ fmtDate: () => '' }));
mock.module('../src/components/portal/panels', () => ({ Section: ({ children }: any) => <div>{children}</div> }));
mock.module('../src/components/portal/badges', () => ({ Pill: ({ children }: any) => <span>{children}</span> }));
mock.module('../src/components/portal/file-viewer', () => ({ openFileViewer: () => {} }));
const { useJobFile, SectionDocuments } = await import('../src/components/portal/jobfile');
const originalNow = Date.now;
let clock = originalNow();
let client: QueryClient;
beforeEach(() => {
  calls = 0; version = '1'; clock = originalNow(); Date.now = () => clock;
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); Date.now = originalNow; });
function History() {
  const { data } = useJobFile('qa-job');
  return <output>{data?.documents[0]?.version ?? 'pending'}</output>;
}
const mount = (node: React.ReactNode = <History />) => render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
const reads = async (expected: number) => { await waitFor(() => expect(calls).toBe(expected)); await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); };

test('fresh remount reuses history; remount after 30 seconds reads the other Office user update', async () => {
  const first = mount(); await reads(1); expect(first.getByRole('status').textContent).toBe('1'); first.unmount();
  version = '2'; clock += 29_999;
  const fresh = mount(); await reads(1); expect(fresh.getByRole('status').textContent).toBe('1'); fresh.unmount();
  clock += 2;
  const stale = mount(); await reads(2); await waitFor(() => expect(stale.getByRole('status').textContent).toBe('2'));
});

test('explicit invalidation refetches mounted readers immediately and unmounted readers on remount', async () => {
  const first = mount(); await reads(1); version = '2';
  await act(async () => { await client.invalidateQueries({ queryKey: ['jobfile', 'qa-job'] }); });
  await reads(2); expect(first.getByRole('status').textContent).toBe('2'); first.unmount(); version = '3';
  await client.invalidateQueries({ queryKey: ['jobfile', 'qa-job'] });
  const reopened = mount(); await reads(3); await waitFor(() => expect(reopened.getByRole('status').textContent).toBe('3'));
});

test('document rows defer first mount but retain nested disclosure state through section close/reopen', async () => {
  const view = mount(<SectionDocuments jobId="qa-job" categories={['Property']} />); await reads(1);
  const details = view.container.querySelector('details');
  if (!details) throw new Error('Document section did not render');
  expect(view.queryByRole('button', { name: 'Synthetic document' })).toBeNull();
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); });
  fireEvent.click(view.getByRole('button', { name: 'Synthetic document' }));
  const row = view.container.querySelector('li'); const metadata = row?.querySelector('dl');
  expect(metadata).not.toBeNull();
  await act(async () => { details.open = false; fireEvent(details, new Event('toggle')); });
  expect(view.container.querySelector('li')).toBe(row); expect(row?.querySelector('dl')).toBe(metadata);
  await act(async () => { details.open = true; fireEvent(details, new Event('toggle')); });
  expect(view.container.querySelector('li')).toBe(row); expect(row?.querySelector('dl')).toBe(metadata);
  fireEvent.click(view.getByRole('button', { name: 'Synthetic document' }));
  expect(row?.querySelector('dl')).toBeNull(); expect(calls).toBe(1);
});