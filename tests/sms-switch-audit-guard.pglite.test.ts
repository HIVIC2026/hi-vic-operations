import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const db = new PGlite();
const sql = readFileSync(new URL("../docs/pending-migrations/0231_sms_switch_audit_guard.sql", import.meta.url), "utf8");
const switches = () => db.query<{ s: Record<string, unknown>; u: string }>("select sms_message_switches s, updated_at::text u from public.workflow_settings where id=1").then((r) => r.rows[0]!);
const audits = () => db.query<{ n: number }>("select count(*)::int n from public.admin_config_events where event_type='sms_switches_db_change'").then((r) => r.rows[0]!.n);

beforeAll(async () => {
  await db.exec(`
    create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role anon; create role authenticated;
    create table public.workflow_settings(id int primary key, sms_message_switches jsonb not null default '{}', updated_at timestamptz not null default '2026-10-27');
    insert into public.workflow_settings values (1, '{"spot_saved":true,"spot_saved_email":true,"owner_code":true,"save_spot_reminder":true}', '2026-10-27');
    create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}', created_at timestamptz not null default now());`);
  await db.exec(sql);
});
afterAll(async () => { await db.close(); });

test("turning every switch off in one write is refused and nothing changes", async () => {
  await expect(db.exec(`update public.workflow_settings set sms_message_switches='{"spot_saved":false,"spot_saved_email":false,"owner_code":false,"save_spot_reminder":false}' where id=1`)).rejects.toThrow("Change one switch at a time");
  expect((await switches()).s.spot_saved_email).toBe(true);
  expect(await audits()).toBe(0);
});

test("one switch change writes exactly one audit row and bumps updated_at", async () => {
  await db.exec(`update public.workflow_settings set sms_message_switches = sms_message_switches || '{"owner_code":false}' where id=1`);
  const row = await switches();
  expect(row.s.owner_code).toBe(false);
  expect(row.u.startsWith("2026-10-27")).toBe(false);
  expect(await audits()).toBe(1);
});

test("reminder switch + its activated_at timestamp still saves", async () => {
  await db.exec(`update public.workflow_settings set sms_message_switches = sms_message_switches || '{"save_spot_reminder":false,"save_spot_reminder_activated_at":"2026-10-29T00:00:00Z"}' where id=1`);
  expect((await switches()).s.save_spot_reminder).toBe(false);
  expect(await audits()).toBe(2);
});

test("a deliberately approved bulk change is allowed and still audited", async () => {
  await db.exec(`begin; select set_config('hivic.bulk_switch_change','approved',true); update public.workflow_settings set sms_message_switches = sms_message_switches || '{"owner_code":true,"save_spot_reminder":true}' where id=1; commit;`);
  expect((await switches()).s.owner_code).toBe(true);
  expect(await audits()).toBe(3);
});

test("writes that don't change the switches add no audit row", async () => {
  await db.exec(`update public.workflow_settings set sms_message_switches = sms_message_switches where id=1`);
  expect(await audits()).toBe(3);
});
