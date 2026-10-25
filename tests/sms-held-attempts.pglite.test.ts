// Decision 165 (Jo, 24 Oct 2026) proven on a practice Postgres (PGlite): a text held by a switch does NOT claim the
// idempotency key; once the switch is on the same key sends exactly once; a second attempt is "already"; a stale one-off
// trigger is held without claiming; held attempts stay visible as "blocked" rows. No live database, no Twilio.
import { beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

// Decision 361: job_offer keeps SMS quiet hours (8pm–7am Melbourne), so these tests run at a fixed 1pm Melbourne.
setSystemTime(new Date("2026-10-22T02:00:00Z"));
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { HELD_KEY_MARK } from "../src/lib/sms.core";

const db = new PGlite();
await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid'; create role authenticated; create role service_role;
  create function public.has_role(uuid, text) returns boolean language sql as 'select false';
  create table public.workflow_settings(id int primary key, daily_mitti_text_enabled boolean not null default false); insert into public.workflow_settings values (1);
  create table public.jobs(id uuid primary key, source text, deleted_at timestamptz);
  create table public.businesses(id uuid primary key, is_active boolean, approved_at timestamptz, onboarding_notes text);
  create table public.job_communications(id uuid primary key default gen_random_uuid(), job_id uuid, direction text, channel text, recipients text[], subject text, body text, provider text, sent_at timestamptz, delivery_status text, visibility text, source_event text, source_reference text);
  insert into public.businesses values ('11111111-1111-1111-1111-111111111111', true, now(), null);`);
await db.exec(readFileSync("docs/pending-migrations/0141_real_sms_sender.sql", "utf8"));

let commsOn = true;
const twilioCalls: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db, { jsonColumns: { workflow_settings: ["sms_message_switches"] } }) }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn, hasCurrentOwnerContactConsent: async () => true }));
mock.module("../src/lib/twilio-au1.server", () => ({
  au1Configured: () => true,
  au1SendMessage: async (p: URLSearchParams) => { twilioCalls.push(p.get("Body") ?? ""); return { ok: true, status: 201, text: JSON.stringify({ sid: `SM${twilioCalls.length}` }) }; },
}));
process.env["TWILIO_FROM_NUMBER"] = "+61480000000";
const { sendRealSms } = await import("../src/lib/sms.server");

const BIZ = "11111111-1111-1111-1111-111111111111";
const setSwitch = (type: string, on: boolean) => db.query(`update public.workflow_settings set sms_message_switches = sms_message_switches || $1::jsonb where id = 1`, [JSON.stringify({ [type]: on })]);
const rows = async (prefix: string) => (await db.query<{ idempotency_key: string; status: string; detail: string | null }>("select idempotency_key, status, detail from public.sms_messages where idempotency_key like $1 order by created_at, idempotency_key", [`${prefix}%`])).rows;
const nowIso = () => new Date().toISOString();

beforeEach(() => { commsOn = true; });

describe("decision 165: held attempts never claim the key", () => {
  test("switch off → held (no claim) → switch on → sent once → second attempt 'already'", async () => {
    await setSwitch("job_offer", false);
    const input = { type: "job_offer" as const, idempotencyKey: "job-offer:v1:offer-A", to: "0412 345 678", body: "New job offer", businessId: BIZ, event: { at: nowIso(), current: true } };
    const held = await sendRealSms(input);
    expect(held.status).toBe("blocked");
    expect(held.detail).toContain("switched off");
    let r = await rows("job-offer:v1:offer-A");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("blocked");
    expect(r[0]!.idempotency_key).toContain(HELD_KEY_MARK); // recorded, but under a NON-claiming key
    expect(r[0]!.detail).toContain("switched off"); // office can still answer "why wasn't this sent"
    expect(twilioCalls).toHaveLength(0);

    // A second held attempt is recorded too (another visible "held" row), still no claim.
    expect((await sendRealSms(input)).status).toBe("blocked");
    expect((await rows("job-offer:v1:offer-A")).every((x) => x.status === "blocked" && x.idempotency_key.includes(HELD_KEY_MARK))).toBe(true);

    await setSwitch("job_offer", true);
    const sent = await sendRealSms(input);
    expect(sent.status).toBe("sent");
    expect(twilioCalls).toHaveLength(1);
    r = await rows("job-offer:v1:offer-A");
    expect(r.filter((x) => x.idempotency_key === "job-offer:v1:offer-A")).toHaveLength(1); // the real claim
    expect(r.find((x) => x.idempotency_key === "job-offer:v1:offer-A")!.status).toBe("sent");

    const again = await sendRealSms(input);
    expect(again.status).toBe("already");
    expect(twilioCalls).toHaveLength(1); // exactly once
  });

  test("master switch off is a hold too, and a hold after a real send stays 'already' without a new held row", async () => {
    await setSwitch("job_offer", true);
    const input = { type: "job_offer" as const, idempotencyKey: "job-offer:v1:offer-B", to: "0412 345 678", body: "Offer B", businessId: BIZ, event: { at: nowIso(), current: true } };
    commsOn = false;
    expect((await sendRealSms(input)).status).toBe("blocked");
    expect((await rows("job-offer:v1:offer-B")).map((x) => x.status)).toEqual(["blocked"]);
    commsOn = true;
    expect((await sendRealSms(input)).status).toBe("sent");
    commsOn = false;
    expect((await sendRealSms(input)).status).toBe("already");
    expect((await rows("job-offer:v1:offer-B")).filter((x) => x.status === "blocked")).toHaveLength(1); // no second held row
  });

  test("a stale one-off trigger is held without claiming; a fresh trigger with the same key then sends once", async () => {
    await setSwitch("job_offer", true);
    const old = new Date(Date.now() - 30 * 3600_000).toISOString();
    const key = "job-offer:v1:offer-C";
    const stale = await sendRealSms({ type: "job_offer", idempotencyKey: key, to: "0412 345 678", body: "Offer C", businessId: BIZ, event: { at: old, current: true } });
    expect(stale.status).toBe("blocked");
    expect(stale.detail).toContain("Too late");
    const closed = await sendRealSms({ type: "job_offer", idempotencyKey: key, to: "0412 345 678", body: "Offer C", businessId: BIZ, event: { at: nowIso(), current: false } });
    expect(closed.status).toBe("blocked");
    expect(closed.detail).toContain("no longer current");
    const none = await sendRealSms({ type: "job_offer", idempotencyKey: key, to: "0412 345 678", body: "Offer C", businessId: BIZ });
    expect(none.status).toBe("blocked");
    expect(none.detail).toContain("No triggering event time");
    expect((await rows(key)).filter((x) => x.idempotency_key === key)).toHaveLength(0); // nothing claimed
    const before = twilioCalls.length;
    expect((await sendRealSms({ type: "job_offer", idempotencyKey: key, to: "0412 345 678", body: "Offer C", businessId: BIZ, event: { at: nowIso(), current: true } })).status).toBe("sent");
    expect(twilioCalls).toHaveLength(before + 1);
  });

  test("window types (daily Mitti) need no trigger time: the key names the window", async () => {
    await setSwitch("daily_mitti", true);
    await db.query("update public.workflow_settings set daily_mitti_text_enabled = true where id = 1");
    const r = await sendRealSms({ type: "daily_mitti", idempotencyKey: "daily-mitti:daily:biz:2026-10-24", to: "0412 345 678", body: "Links", businessId: BIZ });
    expect(r.status).toBe("sent");
    expect((await sendRealSms({ type: "daily_mitti", idempotencyKey: "daily-mitti:daily:biz:2026-10-24", to: "0412 345 678", body: "Links", businessId: BIZ })).status).toBe("already");
  });

  test("an earlier plain-key 'blocked' row from before decision 165 still reads as 'already' (old holds never re-fire)", async () => {
    await db.query(`insert into public.sms_messages(message_type, idempotency_key, to_number, body, status, detail) values ('job_offer','job-offer:v1:legacy','+61412345678','x','blocked','held before decision 165')`);
    await setSwitch("job_offer", true);
    const r = await sendRealSms({ type: "job_offer", idempotencyKey: "job-offer:v1:legacy", to: "0412 345 678", body: "Legacy", businessId: BIZ, event: { at: nowIso(), current: true } });
    expect(r.status).toBe("already"); // old holds never re-fire
  });
});
