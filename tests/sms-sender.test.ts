import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { mapTwilioStatus, smsBlocker, stopKeyword, toAuE164, brandSmsBody, SMS_BRAND_PREFIX, SMS_FRESHNESS, SMS_MESSAGE_TYPES, claimKeyOf, claimsIdempotencyKey, heldAttemptKey, isHeldAttemptKey, smsOutcomeClass, smsStaleReason } from "../src/lib/sms.core";

describe("decision 165: outcome classes, non-claiming held keys and freshness (pure)", () => {
  test("three outcome classes; only sent/failed claim the key", () => {
    expect(smsOutcomeClass("sent")).toBe("sent");
    expect(smsOutcomeClass("sent_unknown")).toBe("sent");
    expect(smsOutcomeClass("failed")).toBe("failed");
    expect(smsOutcomeClass("blocked")).toBe("blocked");
    expect(claimsIdempotencyKey("sent")).toBe(true);
    expect(claimsIdempotencyKey("failed")).toBe(true);
    expect(claimsIdempotencyKey("blocked")).toBe(false);
  });
  test("held attempt keys never collide with the real claim and map back to it", () => {
    const k = heldAttemptKey("quote-ready:v1:q1", "a1");
    expect(k).not.toBe("quote-ready:v1:q1");
    expect(isHeldAttemptKey(k)).toBe(true);
    expect(isHeldAttemptKey("quote-ready:v1:q1")).toBe(false);
    expect(claimKeyOf(k)).toBe("quote-ready:v1:q1");
    expect(heldAttemptKey("k", "a1")).not.toBe(heldAttemptKey("k", "a2"));
  });
  test("every message type declares a freshness policy", () => {
    for (const t of Object.keys(SMS_MESSAGE_TYPES)) expect(SMS_FRESHNESS[t as keyof typeof SMS_FRESHNESS]).toBeDefined();
  });
  const now = "2026-10-24T03:00:00Z";
  test("one-off (event) types: fresh sends, old is held, closed is held, missing trigger is held", () => {
    expect(smsStaleReason("job_offer", { at: "2026-10-24T02:00:00Z" }, now)).toBeNull();
    expect(smsStaleReason("job_offer", { at: "2026-10-22T02:00:00Z" }, now)).toContain("Too late");
    expect(smsStaleReason("job_offer", { at: "2026-10-24T02:00:00Z", current: false }, now)).toContain("no longer current");
    expect(smsStaleReason("job_offer", undefined, now)).toContain("No triggering event time");
    expect(smsStaleReason("job_offer", { at: null }, now)).toContain("No triggering event time");
    expect(smsStaleReason("job_offer", { at: "garbage" }, now)).toContain("unreadable");
  });
  test("per-type limits: owner code 10 minutes, spot saved / offer / Ready Check gaps 24h, quote ready 72h", () => {
    expect(smsStaleReason("owner_code", { at: "2026-10-24T02:52:00Z" }, now)).toBeNull();
    expect(smsStaleReason("owner_code", { at: "2026-10-24T02:49:00Z" }, now)).toContain("Too late");
    expect(smsStaleReason("spot_saved", { at: "2026-10-23T03:30:00Z" }, now)).toBeNull();
    expect(smsStaleReason("spot_saved", { at: "2026-10-23T02:30:00Z" }, now)).toContain("Too late");
    expect(smsStaleReason("ready_check_incomplete", { at: "2026-10-23T02:30:00Z" }, now)).toContain("Too late");
    expect(smsStaleReason("quote_ready", { at: "2026-10-21T04:00:00Z" }, now)).toBeNull();
    expect(smsStaleReason("quote_ready", { at: "2026-10-21T02:00:00Z" }, now)).toContain("Too late");
  });
  test("window types (scheduled/recomputed) are never stale here: their key names the window", () => {
    for (const t of ["daily_mitti", "daily_mitti_update", "esc_notice_link", "veec_sign_request", "veec_sign_reminder", "save_spot_reminder"]) {
      expect(SMS_FRESHNESS[t as keyof typeof SMS_FRESHNESS].kind).toBe("window");
      expect(smsStaleReason(t, undefined, now)).toBeNull();
    }
  });
  test("unknown type fails closed", () => expect(smsStaleReason("nope", { at: now }, now)).toContain("Unknown"));
});

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
  test("unknown type never sends (no type is unapproved since decision 171; the gate still fails closed)", () => expect(smsBlocker({ ...ok, type: "not_a_type" } as never)).toContain("Unknown"));
  test("decisions 83/87: quote_ready and usual_electrician_missing wording approved — still behind the master switch and their own switches", () => {
    expect(smsBlocker({ ...ok, type: "quote_ready" })).toBeNull();
    expect(smsBlocker({ ...ok, type: "quote_ready", commsEnabled: false })).toContain("switched off");
    expect(smsBlocker({ ...ok, type: "quote_ready", typeSwitchOn: false })).toContain("switched off");
    expect(smsBlocker({ ...ok, type: "usual_electrician_missing", commsEnabled: false })).toContain("switched off");
  });
  test("decision 154: job_offer and esc_notice_link wording approved — still behind the master switch and their own switches", () => {
    expect(smsBlocker({ ...ok, type: "job_offer" })).toBeNull();
    expect(smsBlocker({ ...ok, type: "job_offer", commsEnabled: false })).toContain("switched off");
    expect(smsBlocker({ ...ok, type: "job_offer", typeSwitchOn: false })).toContain("switched off");
    expect(smsBlocker({ ...ok, type: "job_offer", consent: false })).toContain("not approved and active");
    expect(smsBlocker({ ...ok, type: "esc_notice_link", nowIso: "2026-10-22T02:00:00Z" })).toBeNull();
    expect(smsBlocker({ ...ok, type: "esc_notice_link", nowIso: "2026-10-22T02:00:00Z", commsEnabled: false })).toContain("switched off");
  });
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
