// Jo 26 Oct: the AI email replies auto-send switch, proven on a practice Postgres (PGlite), never the live database.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
  create table public.workflow_settings(id int primary key, customer_comms_enabled boolean not null default false, daily_mitti_text_enabled boolean not null default false,
    mitti_pickup_auto_enabled boolean not null default false, sms_message_switches jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
  insert into public.workflow_settings(id) values (1);
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db, { jsonColumns: { workflow_settings: ["sms_message_switches"], admin_config_events: ["details"] } }) }));
const { officeSwitches, setOfficeSwitch } = await import("../src/lib/office-settings.server");
const { autoSendSwitchOn } = await import("../src/lib/ai-email-reply.server");
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const MIGRATION = readFileSync("docs/pending-migrations/ai-email-auto-send-switch.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/ai-email-auto-send-switch.rollback.sql", "utf8");
const sw = async () => (await officeSwitches()).switches.find((s) => s.key === "ai_email_auto_send")!;

describe("AI reply auto-send switch", () => {
  test("before the migration: off, not editable, nothing auto-sends", async () => {
    expect(await sw()).toMatchObject({ on: false, editable: false });
    await expect(setOfficeSwitch("ai_email_auto_send", true, false, "samples approved", ACTOR)).rejects.toThrow(/database change/);
    expect(await autoSendSwitchOn()).toBe(false);
  });
  test("migration adds it OFF, idempotent", async () => {
    await db.exec(MIGRATION); await db.exec(MIGRATION);
    expect(await sw()).toMatchObject({ on: false, editable: true });
    expect(await autoSendSwitchOn()).toBe(false);
  });
  test("Jo turns it on (audited); re-applying never resets it", async () => {
    await setOfficeSwitch("ai_email_auto_send", true, false, "samples approved", ACTOR);
    expect(await autoSendSwitchOn()).toBe(true);
    expect((await db.query("select event_type from public.admin_config_events")).rows).toEqual([{ event_type: "office_switch_changed" }]);
    await db.exec(MIGRATION);
    expect(await autoSendSwitchOn()).toBe(true);
  });
  test("rollback removes it and auto-send is off again", async () => {
    await db.exec(ROLLBACK);
    expect(await autoSendSwitchOn()).toBe(false);
  });
});
