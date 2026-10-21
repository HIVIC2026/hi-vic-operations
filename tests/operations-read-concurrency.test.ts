import { expect, test } from 'bun:test';
import { loadOperationsPreview } from '../src/lib/operations-preview.server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/integrations/supabase/types';

test('secondary facts and originating business start before the first fact batch finishes', async () => {
  const started: string[] = [];
  let unblock: (() => void) | undefined;
  const held = new Promise<void>(resolve => { unblock = resolve; });
  const client = { from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const name of ['select','eq','is','or','in','order','range','maybeSingle','not']) q[name] = () => q;
    q.then = async (resolve: (value: unknown) => unknown) => {
      started.push(table);
      if (table === 'lead_campaign_responses') await held;
      if (table === 'businesses') {
        expect(started).toContain('external_action_outbox');
        expect(started).toContain('appointment_proposals');
        unblock?.();
      }
      const data = table === 'jobs' ? [{ id: 'TEST', source: 'website', stage: 'new_enquiry', business_unit: 'hivic', originating_installer_business_id: 'TEST-BUSINESS', created_at: '2026-10-01' }]
        : table === 'workflow_settings' ? { customer_comms_enabled: false }
        : table === 'customer_delivery_settings' ? { enabled: false } : [];
      return resolve({ data, error: null });
    };
    return q;
  } } as unknown as SupabaseClient<Database>;
  const result = await loadOperationsPreview(client);
  expect(result.rows).toHaveLength(1);
});