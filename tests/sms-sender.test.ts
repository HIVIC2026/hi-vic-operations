import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { mapTwilioStatus, smsBlocker, stopKeyword, toAuE164, brandSmsBody, SMS_BRAND_PREFIX } from "../src/lib/sms.core";

const ok = { type: "spot_saved", to: "0477 511 901", commsEnabled: true, typeSwitchOn: true, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, nowIso: "2026-10-22T00:00:00Z" };

describe("real SMS gate", () => {
  test("all checks pass → may send", () => expect(smsBlocker(ok)).toBeNull());
  test("master switch off", () => expect(smsBlocker({ ...ok, commsEnabled: false })).toContain("switched off"));
  test("message switch off", () => expect(smsBlocker({ ...ok, typeSwitchOn: false })).toContain("switched off"));
  test("STOP", () => expect(smsBlocker({ ...ok, optedOut: true })).toContain("STOP"));
  test("no consent", () => expect(smsBlocker({ ...ok, consent: false })).toContain("consent"));
  test("no AU number", () => expect(smsBlocker({ ...ok, senderConfigured: false })).toContain("Australian sending number"));
  test("non-AU mobile", () => expect(smsBlocker({ ...ok, to: "+1 415 555 0100" })).toContain("Australian mobile"));
  test("TEST records stay on the test sender", () => expect(smsBlocker({ ...ok, isTestRecord: true })).toContain("TEST"));
  test("unapproved wording never sends", () => expect(smsBlocker({ ...ok, type: "quote_ready" })).toContain("Wording"));
  test("decision 154: job_offer and esc_notice_link wording approved — still behind the master switch and their own switches", () => {
    expect(smsBlocker({ ...ok, type: "job_offer" })).toBeNull();
    expect(smsBlocker({ ...ok, type: "job_offer", commsEnabled: false })).toContain("switched off");
    expect(smsBlocker({ ...ok, type: "job_offer", typeSwitchOn: false })).toContain("switched off");
    expect(smsBlocker({ ...ok, type: "job_offer", consent: false })).toContain("not approved and active");
    expect(smsBlocker({ ...ok, type: "esc_notice_link", nowIso: "2026-10-22T02:00:00Z" })).toBeNull();
    expect(smsBlocker({ ...ok, type: "esc_notice_link", nowIso: "2026-10-22T02:00:00Z", commsEnabled: false })).toContain("switched off");
  });
  test("usual-electrician reminder remains blocked without approved wording", () => expect(smsBlocker({ ...ok, type: "usual_electrician_missing" })).toContain("Wording"));
  test("unknown type fails closed", () => expect(smsBlocker({ ...ok, type: "nope" })).toContain("Unknown"));
  test("AU formatting", () => {
    expect(toAuE164("0477 511 901")).toBe("+61477511901");
    expect(toAuE164("+61 477 511 901")).toBe("+61477511901");
    expect(toAuE164("12345")).toBeNull();
  });
  test("STOP/START keywords", () => {
    expect(stopKeyword(" stop ")).toBe("stop");
    expect(stopKeyword("Unsubscribe")).toBe("stop");
    expect(stopKeyword("START")).toBe("start");
    expect(stopKeyword("stop the job")).toBeNull();
  });
  test("delivery status mapping", () => {
    expect(mapTwilioStatus("delivered")).toBe("delivered");
    expect(mapTwilioStatus("undelivered")).toBe("undelivered");
    expect(mapTwilioStatus("queued")).toBe("queued");
    expect(mapTwilioStatus("weird")).toBeNull();
  });
});

describe("brand prefix on every text (Jo, 8 Oct)", () => {
  test("plain body gets the brand line", () => {
    expect(brandSmsBody("Your measure-up is booked for Friday 8am.")).toBe("Home Insulation Victoria: Your measure-up is booked for Friday 8am.");
  });
  test("never doubles the prefix", () => {
    expect(brandSmsBody(SMS_BRAND_PREFIX + "Hello")).toBe(SMS_BRAND_PREFIX + "Hello");
    expect(brandSmsBody(brandSmsBody("Hello"))).toBe(brandSmsBody("Hello"));
  });
  test("brand line uses the visible brand, never a retired name", () => {
    expect(SMS_BRAND_PREFIX).toBe("Home Insulation Victoria: ");
    expect(SMS_BRAND_PREFIX).not.toMatch(/HI ?VIC/i);
  });
});

describe("0141 migration (practice database)", () => {
  test("applies; idempotency key is unique; switches default off", async () => {
    const db = new PGlite();
    await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid'; create role authenticated; create role service_role;
      create function public.has_role(uuid, text) returns boolean language sql as 'select false';
      create table public.workflow_settings(id int primary key); insert into public.workflow_settings values (1);
      create table public.jobs(id uuid primary key); create table public.businesses(id uuid primary key);`);
    await db.exec(readFileSync("docs/pending-migrations/0141_real_sms_sender.sql", "utf8"));
    const s = await db.query<{ v: unknown }>("select sms_message_switches v from public.workflow_settings");
    expect(s.rows[0]!.v).toEqual({});
    await db.exec(`insert into public.sms_messages(message_type, idempotency_key, to_number, body, status) values ('spot_saved','k1','+61477511901','x','sending')`);
    await expect(db.exec(`insert into public.sms_messages(message_type, idempotency_key, to_number, body, status) values ('spot_saved','k1','+61477511901','x','sending')`)).rejects.toThrow();
    await expect(db.exec(`insert into public.sms_optouts(phone) values ('0477511901')`)).rejects.toThrow();
  });
});
