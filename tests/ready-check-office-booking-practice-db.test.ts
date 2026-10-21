import { beforeAll, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { postgrestShim } from './helpers/pglite-postgrest-shim';
import { ownerBookingAllowed } from '../src/lib/ready-check-booking-access.core';

const db = new PGlite();
const job = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const actor = '00000000-0000-4000-8000-000000000003';
beforeAll(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '${actor}'::uuid $$;
    CREATE TABLE role_test (office boolean); INSERT INTO role_test VALUES(true);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ SELECT office FROM role_test $$;
    CREATE TABLE workflow_settings(id int PRIMARY KEY, customer_comms_enabled boolean DEFAULT false);
    INSERT INTO workflow_settings(id) VALUES(1);
    CREATE TABLE jobs(id uuid PRIMARY KEY, stage text DEFAULT 'ready_check_ready_to_schedule', deleted_at timestamptz, source text DEFAULT 'qa_test');
    INSERT INTO jobs(id) VALUES('${job}'),('${other}');
    CREATE TABLE ready_check_acceptances(id serial, job_id uuid, ready_check_amount_inc_gst numeric DEFAULT 0);
    CREATE TABLE ready_check_windows(id serial, job_id uuid, status text DEFAULT 'open');
    CREATE TABLE workflow_events(job_id uuid,actor_id uuid,event_type text,summary text,details jsonb,internal boolean);
    CREATE TABLE admin_config_events(actor_id uuid,event_type text,summary text,details jsonb);
  `);
  await db.exec(readFileSync('docs/pending-migrations/0220_office_ready_check_booking.sql', 'utf8'));
});
mock.module('@/integrations/supabase/client.server', () => ({ supabaseAdmin: postgrestShim(db) }));
const { assertOwnerReadyCheckBooking, readyCheckBookingAccess } = await import('../src/lib/ready-check-booking-access.server');

test('setting defaults OFF; old acceptance and times inserts reject with no rows or other switch changes', async () => {
  expect((await db.query('select ready_check_booking_enabled from workflow_settings')).rows[0]?.ready_check_booking_enabled).toBe(false);
  await expect(db.exec(`insert into ready_check_acceptances(job_id) values('${job}')`)).rejects.toThrow('booking is not open');
  await expect(db.exec(`insert into ready_check_windows(job_id) values('${job}')`)).rejects.toThrow('booking is not open');
  await expect(assertOwnerReadyCheckBooking(job)).rejects.toThrow('booking is not open');
  expect((await db.query('select count(*)::int n from ready_check_acceptances')).rows[0]?.n).toBe(0);
  expect((await db.query('select count(*)::int n from ready_check_windows')).rows[0]?.n).toBe(0);
  expect((await db.query('select customer_comms_enabled from workflow_settings')).rows[0]?.customer_comms_enabled).toBe(false);
});
test('switch ON alone never authorises an owner; Office offer required for exact job', async () => {
  await db.exec('select set_ready_check_booking_enabled(true)');
  await expect(assertOwnerReadyCheckBooking(job)).rejects.toThrow('booking is not open');
  await db.exec(`select offer_owner_ready_check_booking('${job}')`);
  expect((await readyCheckBookingAccess(job)).allowed).toBe(true);
  await assertOwnerReadyCheckBooking(job);
  await db.exec(`insert into ready_check_acceptances(job_id) values('${job}'); insert into ready_check_windows(job_id) values('${job}')`);
  await expect(assertOwnerReadyCheckBooking(other)).rejects.toThrow('booking is not open');
  expect((await db.query('select count(*)::int n from workflow_events')).rows[0]?.n).toBe(1);
  await db.exec(`select offer_owner_ready_check_booking('${job}')`);
  expect((await db.query('select count(*)::int n from workflow_events')).rows[0]?.n).toBe(1);
});
test('OFF after an offer rejects old pages/retries without changing existing acceptance/windows', async () => {
  const before = await db.query('select * from ready_check_acceptances');
  await db.exec('select set_ready_check_booking_enabled(false)');
  await expect(assertOwnerReadyCheckBooking(job)).rejects.toThrow('booking is not open');
  await expect(db.exec(`insert into ready_check_windows(job_id) values('${job}')`)).rejects.toThrow('booking is not open');
  expect((await db.query('select * from ready_check_acceptances')).rows).toEqual(before.rows);
  expect((await db.query('select count(*)::int n from ready_check_windows')).rows[0]?.n).toBe(1);
});
test('non-office cannot offer, toggle or spoof job offer fields', async () => {
  await db.exec('update role_test set office=false');
  await expect(db.exec(`select offer_owner_ready_check_booking('${other}')`)).rejects.toThrow('Only office');
  await expect(db.exec('select set_ready_check_booking_enabled(true)')).rejects.toThrow('Only office');
  await expect(db.exec(`update jobs set ready_check_booking_offered_at=now(),ready_check_booking_offered_by='${actor}' where id='${other}'`)).rejects.toThrow('Only office');
  await db.exec('update role_test set office=true');
});
test('cancelled/deleted jobs fail closed even with an Office offer and switch ON', async () => {
  await db.exec('select set_ready_check_booking_enabled(true)');
  await db.exec(`update jobs set stage='cancelled' where id='${job}'`);
  expect((await readyCheckBookingAccess(job)).allowed).toBe(false);
  await db.exec(`update jobs set stage='ready_check_ready_to_schedule',deleted_at=now() where id='${job}'`);
  expect((await readyCheckBookingAccess(job)).allowed).toBe(false);
});
test('missing setting or offer identity never enables booking', () => {
  expect(ownerBookingAllowed(undefined, 'now', actor, 'ready_check_ready_to_schedule', null)).toBe(false);
  expect(ownerBookingAllowed(true, 'now', null, 'ready_check_ready_to_schedule', null)).toBe(false);
});