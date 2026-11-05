import { expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { postgrestShim } from './helpers/pglite-postgrest-shim';
import { ownMessageSwitch } from '../src/lib/own-customer-message-approval.core';
const db = new PGlite();
await db.exec(`create table workflow_settings(id int primary key, sms_message_switches jsonb not null default '{}', updated_at timestamptz); insert into workflow_settings values(1,'{"job_offer":true}',now()); create table admin_config_events(actor_id uuid,event_type text,summary text,details jsonb);`);
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: postgrestShim(db, { jsonColumns: { workflow_settings: ['sms_message_switches'], admin_config_events: ['details'] } }) }));
const { officeSwitches, setOfficeSwitch } = await import('../src/lib/office-settings.server');
test('practice: approving exactly one email persists one audited key, keeps other messages OFF and refuses stale writes', async () => {
  const key = ownMessageSwitch('own_owner_quote');
  expect((await officeSwitches()).switches.find(s => s.key === key)?.on).toBe(false);
  await setOfficeSwitch(key, true, false, 'Jo approved in Templates', '00000000-0000-4000-8000-000000000001');
  expect((await db.query('select sms_message_switches from workflow_settings')).rows[0]?.sms_message_switches).toEqual({ job_offer: true, [key]: true });
  expect((await db.query('select details from admin_config_events')).rows[0]?.details).toMatchObject({ key, from: false, to: true, reason: 'Jo approved in Templates' });
  await expect(setOfficeSwitch(key, false, false, 'stale request', '00000000-0000-4000-8000-000000000002')).rejects.toThrow('changed this switch');
});