// "Pause all trade messages" (Jo 30 Oct 2026) proven on a practice Postgres (PGlite), never the live database:
// - before the pending SQL the switch reads NOT paused (shown off, not editable) and the sender helper warns;
// - trade-messages-paused.sql adds the column ON (paused) for the existing row, is idempotent and rolls back cleanly;
// - the sms_message_switches guard trigger never blocks or audits this column; its own trigger audits every change;
// - Settings › Switches flips it compare-and-swap with the office_switch_changed audit row.
import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
  create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
  create role anon; create role authenticated;
  create table public.workflow_settings(id int primary key, customer_comms_enabled boolean not null default false, daily_mitti_text_enabled boolean not null default false,
    mitti_pickup_auto_enabled boolean not null default false, sms_message_switches jsonb not null default '{}'::jsonb, updated_at timestamptz not null default '2026-10-27');
  insert into public.workflow_settings(id, sms_message_switches) values (1, '{"job_offer": true, "owner_code": true}');
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
`);
await db.exec(readFileSync("docs/pending-migrations/0231_sms_switch_audit_guard.sql", "utf8"));
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db, { jsonColumns: { workflow_settings: ["sms_message_switches"], admin_config_events: ["details"] } }) }));
const { officeSwitches, setOfficeSwitch } = await import("../src/lib/office-settings.server");
const { tradeMessagesPausedNow } = await import("../src/lib/trade-pause.server");
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const MIGRATION = readFileSync("docs/pending-migrations/trade-messages-paused.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/trade-messages-paused.rollback.sql", "utf8");
const sw = async () => (await officeSwitches()).switches.find((s) => s.key === "trade_messages_paused")!;
const events = async (type: string) => (await db.query<{ summary: string; details: Record<string, unknown> }>("select summary, details from public.admin_config_events where event_type = $1 order by created_at, id", [type])).rows;
const paused = async () => (await db.query<{ v: boolean }>("select trade_messages_paused v from public.workflow_settings where id = 1")).rows[0]!.v;
afterAll(async () => { await db.close(); });

describe("before the SQL is live: not paused, nothing changes", () => {
  test("sender helper → not paused, with a warning", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect(await tradeMessagesPausedNow()).toBeNull();
    expect(String(warn.mock.calls[0]?.[0] ?? "")).toContain("trade_messages_paused");
    warn.mockRestore();
  });
  test("Settings shows it off, not editable, write refused", async () => {
    const s = await sw();
    expect(s.label).toBe("Pause all trade messages");
    expect(s.on).toBe(false);
    expect(s.editable).toBe(false);
    expect(s.note).toContain("trade-messages-paused.sql");
    await expect(setOfficeSwitch("trade_messages_paused", false, true, "x", ACTOR)).rejects.toThrow();
    expect(await events("office_switch_changed")).toHaveLength(0);
  });
});

describe("pending migration trade-messages-paused.sql", () => {
  test("adds the column ON (paused) for the existing row; idempotent", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect(await paused()).toBe(true);
    expect(await tradeMessagesPausedNow()).toBe("Trade messages paused");
    expect((await sw()).on).toBe(true);
    expect((await sw()).editable).toBe(true);
  });

  test("the sms switch guard never fires for it; its own trigger audits once and bumps updated_at", async () => {
    await db.exec("update public.workflow_settings set trade_messages_paused = false where id = 1");
    expect(await paused()).toBe(false);
    expect(await events("sms_switches_db_change")).toHaveLength(0);
    const own = await events("trade_messages_paused_db_change");
    expect(own).toHaveLength(1);
    expect(own[0]!.details).toMatchObject({ from: true, to: false });
    const u = (await db.query<{ u: string }>("select updated_at::text u from public.workflow_settings where id = 1")).rows[0]!.u;
    expect(u.startsWith("2026-10-27")).toBe(false);
    // A no-change write adds no row; the sms guard still refuses a multi-switch write on its own column.
    await db.exec("update public.workflow_settings set trade_messages_paused = false where id = 1");
    expect(await events("trade_messages_paused_db_change")).toHaveLength(1);
    await expect(db.exec(`update public.workflow_settings set sms_message_switches = '{"job_offer": false, "owner_code": false}', trade_messages_paused = true where id = 1`)).rejects.toThrow("Change one switch at a time");
    expect(await paused()).toBe(false);
    expect(await tradeMessagesPausedNow()).toBeNull();
  });

  test("Settings flip is compare-and-swap and audited (office_switch_changed)", async () => {
    await expect(setOfficeSwitch("trade_messages_paused", true, true, "stale view", ACTOR)).rejects.toThrow(/changed this switch/);
    expect(await paused()).toBe(false);
    expect(await setOfficeSwitch("trade_messages_paused", true, false, "Jo: pause trades", ACTOR)).toEqual({ ok: true, unchanged: false });
    expect(await paused()).toBe(true);
    const audit = await events("office_switch_changed");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.summary).toBe("Pause all trade messages turned on");
    expect(audit[0]!.details).toMatchObject({ key: "trade_messages_paused", kind: "column", from: false, to: true, reason: "Jo: pause trades" });
    expect(await events("sms_switches_db_change")).toHaveLength(0);
  });

  test("rollback removes column, trigger and function; repeatable; code back to not paused", async () => {
    await db.exec(ROLLBACK);
    await db.exec(ROLLBACK);
    const cols = await db.query("select 1 from information_schema.columns where table_name = 'workflow_settings' and column_name = 'trade_messages_paused'");
    expect(cols.rows).toHaveLength(0);
    const fn = await db.query("select 1 from pg_proc where proname = 'guard_trade_messages_paused'");
    expect(fn.rows).toHaveLength(0);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect(await tradeMessagesPausedNow()).toBeNull();
    warn.mockRestore();
  });
});
