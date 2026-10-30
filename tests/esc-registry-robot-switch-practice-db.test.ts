// Decision 272: the ESC Registry robot switch proven on a practice Postgres (PGlite), never the live database:
// - docs/pending-migrations/esc-registry-robot-switch.sql adds the column OFF, is idempotent, never resets Jo's value,
//   and rolls back cleanly;
// - before it is applied the Settings page and the robot both fail closed (switch shown off / not editable / write
//   refused; robotSettings → off); after it, Jo can turn it on and the robot still needs the deployment flags.
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
const { robotSettings } = await import("../src/lib/esc-registry-robot.server");
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const MIGRATION = readFileSync("docs/pending-migrations/esc-registry-robot-switch.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/esc-registry-robot-switch.rollback.sql", "utf8");
const sw = async () => (await officeSwitches()).switches.find((s) => s.key === "esc_registry_robot")!;
const ENV_LIVE = { ESC_REGISTRY_ROBOT_ENABLED: "true", ESC_REGISTRY_ROBOT_MODE: "live", VEU_REGISTRY_USERNAME: "ap@example.com", VEU_REGISTRY_PASSWORD: "secret" } as NodeJS.ProcessEnv;

describe("before the migration: fail closed", () => {
  test("Settings row shown off, not editable, write refused; robot off", async () => {
    const s = await sw();
    expect(s).toMatchObject({ on: false, editable: false, note: expect.stringContaining("esc-registry-robot-switch.sql") });
    await expect(setOfficeSwitch("esc_registry_robot", true, false, "turn on", ACTOR)).rejects.toThrow(/database change/);
    const r = await robotSettings(ENV_LIVE);
    expect(r.mode).toBe("off");
    expect(r.switchOn).toBeNull();
    expect(r.credentials).toBeNull(); // never handed out while off
  });
});

describe("pending migration esc-registry-robot-switch.sql on PGlite", () => {
  test("adds the column OFF by default, idempotent, NOT NULL", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    expect((await db.query<{ v: boolean }>("select esc_registry_robot_enabled v from public.workflow_settings where id = 1")).rows[0]!.v).toBe(false);
    await expect(db.exec("update public.workflow_settings set esc_registry_robot_enabled = null")).rejects.toThrow();
  });
  test("switch off after the migration: robot still off, Settings row editable", async () => {
    expect(await sw()).toMatchObject({ on: false, editable: true });
    expect((await robotSettings(ENV_LIVE)).mode).toBe("off");
  });
  test("Jo turns it on (compare-and-swap, audited): the robot sees it (the per-task verified mark is applied per job, not here); deployment flags are separate locks", async () => {
    await setOfficeSwitch("esc_registry_robot", true, false, "first supervised run", ACTOR);
    expect((await sw()).on).toBe(true);
    const audits = (await db.query<{ event_type: string; details: { key: string; to: boolean } }>("select event_type, details from public.admin_config_events")).rows;
    expect(audits).toEqual([{ event_type: "office_switch_changed", details: expect.objectContaining({ key: "esc_registry_robot", to: true }) }]);
    const live = await robotSettings(ENV_LIVE);
    expect(live.switchOn).toBe(true);
    expect(live.mode).toBe("live");
    expect(live.credentials).toEqual({ username: "ap@example.com", password: "secret" });
    expect((await robotSettings({ ...ENV_LIVE, ESC_REGISTRY_ROBOT_ENABLED: "false" })).mode).toBe("off");
    expect((await robotSettings({ ...ENV_LIVE, VEU_REGISTRY_PASSWORD: "" })).mode).toBe("off");
    expect((await robotSettings({ ...ENV_LIVE, ESC_REGISTRY_ROBOT_MODE: undefined })).mode).toBe("dry_run");
    await db.exec(MIGRATION); // re-applying never resets a switch Jo turned on
    expect((await sw()).on).toBe(true);
  });
  test("rollback removes the column and everything fails closed again", async () => {
    await db.exec(ROLLBACK);
    const cols = await db.query("select column_name from information_schema.columns where table_name = 'workflow_settings' and column_name = 'esc_registry_robot_enabled'");
    expect(cols.rows).toEqual([]);
    expect((await sw()).editable).toBe(false);
    expect((await robotSettings(ENV_LIVE)).mode).toBe("off");
  });
});
