// Office build B (decisions 159, 246, 248) proven on a practice Postgres (PGlite), never the live database:
// - the pending migration docs/pending-migrations/auto-offer-switches.sql adds the two automatic-offer switches OFF,
//   is idempotent and rolls back cleanly;
// - before it is applied the Settings page fails closed (switch shown off, not editable, write refused);
// - flipping a switch is compare-and-swap on the value the office saw (stale → refused, nothing written) and audited;
// - per-type text switches only touch their own key; code switches can never be flipped from the page.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
  create table public.workflow_settings(id int primary key, customer_comms_enabled boolean not null default false, daily_mitti_text_enabled boolean not null default false,
    mitti_pickup_auto_enabled boolean not null default false, sms_message_switches jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
  insert into public.workflow_settings(id, sms_message_switches) values (1, '{"job_offer": true}');
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db, { jsonColumns: { workflow_settings: ["sms_message_switches"], admin_config_events: ["details"] } }) }));
const { officeSwitches, setOfficeSwitch } = await import("../src/lib/office-settings.server");
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const MIGRATION = readFileSync("docs/pending-migrations/auto-offer-switches.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/auto-offer-switches.rollback.sql", "utf8");
const sw = async (key: string) => (await officeSwitches()).switches.find((s) => s.key === key)!;
const audits = async () => (await db.query<{ event_type: string; details: { key: string; from: boolean; to: boolean } }>("select event_type, details from public.admin_config_events order by created_at, id")).rows;

describe("decision 246 switches before the migration: fail closed", () => {
  test("shown off, not editable, write refused", async () => {
    const s = await sw("auto_installer_offers");
    expect(s.on).toBe(false);
    expect(s.editable).toBe(false);
    expect(s.note).toContain("auto-offer-switches.sql");
    await expect(setOfficeSwitch("auto_installer_offers", true, false, "turn on", ACTOR)).rejects.toThrow(/database change/);
    expect(await audits()).toHaveLength(0);
  });
});

describe("pending migration auto-offer-switches.sql on PGlite", () => {
  test("adds both columns OFF by default, idempotent", async () => {
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    const r = (await db.query<{ auto_installer_offers: boolean; auto_electrician_offers: boolean }>("select auto_installer_offers, auto_electrician_offers from public.workflow_settings where id = 1")).rows[0]!;
    expect(r).toEqual({ auto_installer_offers: false, auto_electrician_offers: false });
    expect((await sw("auto_electrician_offers")).editable).toBe(true);
  });

  test("flip is compare-and-swap and audited", async () => {
    await expect(setOfficeSwitch("auto_installer_offers", true, true, "stale view", ACTOR)).rejects.toThrow(/changed this switch/);
    expect((await sw("auto_installer_offers")).on).toBe(false);
    expect(await setOfficeSwitch("auto_installer_offers", true, false, "Jo said go", ACTOR)).toEqual({ ok: true, unchanged: false });
    expect((await sw("auto_installer_offers")).on).toBe(true);
    expect((await sw("auto_electrician_offers")).on).toBe(false);
    const a = await audits();
    expect(a).toHaveLength(1);
    expect(a[0]!.event_type).toBe("office_switch_changed");
    expect(a[0]!.details).toMatchObject({ key: "auto_installer_offers", from: false, to: true });
  });

  test("rollback drops only the two columns; re-apply restores OFF", async () => {
    await db.exec(ROLLBACK);
    const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'workflow_settings'")).rows.map((r) => r.column_name);
    expect(cols).not.toContain("auto_installer_offers");
    expect(cols).toContain("customer_comms_enabled");
    await db.exec(MIGRATION);
    expect((await sw("auto_installer_offers")).on).toBe(false);
  });
});

describe("per-type text switches and code switches", () => {
  test("a text switch only changes its own key (CAS on the whole map)", async () => {
    expect(await setOfficeSwitch("spot_saved", true, false, "approved by Jo", ACTOR)).toMatchObject({ ok: true });
    const m = (await db.query<{ sms_message_switches: Record<string, boolean> }>("select sms_message_switches from public.workflow_settings where id = 1")).rows[0]!.sms_message_switches;
    expect(m).toEqual({ job_offer: true, spot_saved: true });
    await expect(setOfficeSwitch("spot_saved", false, false, "stale", ACTOR)).rejects.toThrow(/changed this switch/);
  });

  test("code switches (auto quote send, ESC consent copy) can't be flipped", async () => {
    expect((await sw("auto_quote_send")).editable).toBe(false);
    await expect(setOfficeSwitch("auto_quote_send", true, false, "try", ACTOR)).rejects.toThrow(/set in code/);
  });

  test("unknown switch refused", async () => {
    await expect(setOfficeSwitch("owner_resign_after_install", true, false, "retired", ACTOR)).rejects.toThrow(/Unknown switch/);
  });
});
