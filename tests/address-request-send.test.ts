// The owner is asked for their full address (email + text) once, then reminded once 24h later. A text refused for
// quiet hours goes on a later tick under the same key, with no second event. In-memory database; senders are fakes.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { SMS_QUIET_REASON, smsQuietReason } from "../src/lib/quote-hold.core";
import { brandSmsBody } from "../src/lib/sms.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
let clockIso = "2026-10-28T01:00:00.000Z"; // 12pm Melbourne

function from(table: string) {
  let op: "select" | "insert" | "update" = "select"; let payload: Row = {}; let lim = Infinity; let one = false; let head = false;
  const orders: { col: string; asc: boolean }[] = [];
  const preds: ((r: Row) => boolean)[] = [];
  const b: Record<string, unknown> & PromiseLike<unknown> = {
    select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return b; },
    eq: (c: string, v: unknown) => { preds.push((r) => get(r, c) === v); return b; },
    in: (c: string, v: unknown[]) => { preds.push((r) => v.includes(get(r, c))); return b; },
    is: (c: string, v: unknown) => { preds.push((r) => (get(r, c) ?? null) === v); return b; },
    gte: (c: string, v: string) => { preds.push((r) => String(get(r, c)) >= v); return b; },
    not: (c: string, opr: string, v: string) => { if (opr !== "in") throw new Error("fake: not " + opr); const vals = v.replace(/[()]/g, "").split(","); preds.push((r) => !vals.includes(String(get(r, c)))); return b; },
    order: (c: string, o?: { ascending?: boolean }) => { orders.push({ col: c, asc: o?.ascending !== false }); return b; },
    range: (f: number, t: number) => { (b as Row)["rng"] = [f, t]; return b; },
    limit: (n: number) => { lim = n; return b; },
    maybeSingle: () => { one = true; return b; },
    single: () => { one = true; return b; },
    insert: (p: Row) => { op = "insert"; payload = p; return b; },
    update: (p: Row) => { op = "update"; payload = p; return b; },
    then: (res, rej) => {
      let data: unknown = null; let count: number | undefined;
      if (op === "insert") { const row = { id: crypto.randomUUID(), created_at: clockIso, ...payload }; (tables[table] ??= []).push(row); data = one ? row : [row]; }
      else if (op === "update") for (const r of (tables[table] ?? []).filter((r) => preds.every((p) => p(r)))) Object.assign(r, payload);
      else {
        let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
        for (const o of [...orders].reverse()) rows = [...rows].sort((x, y) => String(get(x, o.col)).localeCompare(String(get(y, o.col))) * (o.asc ? 1 : -1));
        const rng = (b as Row)["rng"] as [number, number] | undefined;
        if (rng) rows = rows.slice(rng[0], rng[1] + 1);
        count = rows.length;
        rows = rows.slice(0, lim);
        data = head ? null : one ? rows[0] ?? null : rows;
      }
      return Promise.resolve({ data, error: null, count }).then(res, rej);
    },
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
let commsOn = true;
mock.module("../src/lib/comms.server", () => ({
  assertCustomerDeliveryAllowed: async () => { if (!commsOn) throw new Error("Customer messages are switched off"); },
  customerCommsEnabled: async () => commsOn, hasCurrentOwnerContactConsent: async () => true,
}));

const emails: { purpose: string; key: string; to: string; subject: string; text: string; html: string }[] = [];
mock.module("../src/lib/owner-email-send.server", () => ({
  sendGuardedOwnerEmail: async (p: { purpose: string; key: string; to: string; build: (u: string | null) => { subject: string; text: string; html: string } }) => {
    if (emails.some((e) => e.key === p.key)) return "already attempted — not resent";
    const m = p.build("https://unsub"); emails.push({ purpose: p.purpose, key: p.key, to: p.to, ...m }); return "sent";
  },
}));
// Behaves like the real sender for what matters here (wording approval is left out, per the controller ruling): quiet hours,
// then the customer messages switch, each held under a non-claiming key; else one send per key.
const texts: { type: string; key: string; to: string; body: string }[] = [];
const senderCalls: string[] = [];
mock.module("../src/lib/sms.server", () => ({
  sendRealSms: async (i: { type: string; idempotencyKey: string; to: string; body: string; jobId: string }) => {
    senderCalls.push(i.idempotencyKey);
    const rows = (tables["sms_messages"] ??= []);
    const hold = smsQuietReason(clockIso) ?? (commsOn ? null : "Customer communications are switched off");
    if (hold) {
      if (rows.some((r) => r["idempotency_key"] === i.idempotencyKey)) return { status: "already", detail: "Already handled", sid: null };
      rows.push({ id: crypto.randomUUID(), job_id: i.jobId, message_type: i.type, idempotency_key: `${i.idempotencyKey}#held:${crypto.randomUUID()}`, status: "blocked", detail: hold, created_at: clockIso });
      return { status: "blocked", detail: hold, sid: null };
    }
    if (rows.some((r) => r["idempotency_key"] === i.idempotencyKey)) return { status: "already", detail: "Already handled", sid: null };
    rows.push({ id: crypto.randomUUID(), job_id: i.jobId, message_type: i.type, idempotency_key: i.idempotencyKey, status: "sent", detail: "ok", created_at: clockIso });
    texts.push({ type: i.type, key: i.idempotencyKey, to: i.to, body: i.body });
    return { status: "sent", detail: "Twilio AU1 accepted", sid: "SM1" };
  },
}));
let linkReady = true;
const noLink = new Set<string>();
const linkChecks: string[] = [];
mock.module("../src/lib/estimatelink.server", () => ({
  ensureOwnerLink: async (jobId: string) => {
    linkChecks.push(jobId);
    if (!linkReady || noLink.has(jobId)) return false;
    if (!(tables["customer_estimate_links"] ?? []).some((l) => l["job_id"] === jobId)) (tables["customer_estimate_links"] ??= []).push({ id: "l1", job_id: jobId, purpose: "step3_estimate", status: "active", token: "TOKEN123", expires_at: "2027-01-01T00:00:00Z" });
    return true;
  },
}));

const { sweepAddressRequests } = await import("../src/lib/address-request.server");

const GO_LIVE = "2026-10-20T00:00:00Z";
function seed(o: { address?: string | null; goLive?: string | null; createdAt?: string; source?: string } = {}) {
  for (const k of Object.keys(tables)) delete tables[k];
  emails.length = 0; texts.length = 0; senderCalls.length = 0; linkChecks.length = 0; noLink.clear(); linkReady = true; commsOn = true; clockIso = "2026-10-28T01:00:00.000Z";
  tables["workflow_settings"] = [{ id: 1, address_request_live_at: o.goLive === undefined ? GO_LIVE : o.goLive, sms_message_switches: { address_request: true, address_request_reminder: true } }];
  const owner = { id: "o1", full_name: "Pat Owner", email: "pat@example.org", phone: "0400000000" };
  const property = { id: "p1", address_line: o.address === undefined ? "Brighton VIC 3186" : o.address };
  tables["jobs"] = [{ id: "j1", source: o.source ?? "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready", created_at: o.createdAt ?? "2026-10-27T00:00:00Z", deleted_at: null, owner_id: "o1", owners: owner, properties: property }];
  tables["workflow_events"] = []; tables["sms_messages"] = []; tables["customer_estimate_links"] = [];
}
const events = (t: string) => (tables["workflow_events"] ?? []).filter((e) => e["event_type"] === t);
const at = (iso: string) => { clockIso = iso; return sweepAddressRequests(Date.parse(iso)); };

describe("address request: one request, one reminder", () => {
  beforeEach(() => seed());

  test("open job → one email + one text + one event; a second sweep sends nothing", async () => {
    expect(await at("2026-10-28T01:00:00.000Z")).toEqual({ sent: 1, reminded: 0 });
    expect(emails.map((e) => [e.purpose, e.key, e.to])).toEqual([["address_request", "address-request:v1:j1", "pat@example.org"]]);
    expect(texts.map((t) => [t.type, t.key])).toEqual([["address_request", "address-request:v1:j1"]]);
    expect(texts[0]!.body).toBe("Home Insulation Victoria: we need your full address to check your home. Pick it here: https://estimate.homeinsulationvictoria.com.au/my-address/TOKEN123");
    const mail = emails[0]!;
    expect(mail.text).toContain("We need your full address to check your home.");
    expect(mail.text).toContain("https://estimate.homeinsulationvictoria.com.au/my-address/TOKEN123");
    expect(mail.text).toContain("Cheers, the Home Insulation Victoria team");
    expect(mail.html).toContain("https://estimate.homeinsulationvictoria.com.au/my-address/TOKEN123");
    expect(`${mail.text} ${mail.html}`).not.toMatch(/call us|04\d\d|1300|phone/i);
    expect(events("address_request_sent").length).toBe(1);
    expect(events("address_request_sent")[0]!["details"]).toMatchObject({ email: "sent", sms: { status: "sent" } });

    expect(await at("2026-10-28T02:00:00.000Z")).toEqual({ sent: 0, reminded: 0 });
    expect(emails.length).toBe(1); expect(texts.length).toBe(1); expect(events("address_request_sent").length).toBe(1);
  });

  test("24h later → one reminder each, event logged; 48h later → nothing", async () => {
    await at("2026-10-28T01:00:00.000Z");
    expect(await at("2026-10-29T01:00:00.000Z")).toEqual({ sent: 0, reminded: 1 });
    expect(emails.map((e) => [e.purpose, e.key])).toEqual([["address_request", "address-request:v1:j1"], ["address_request_reminder", "address-request-reminder:v1:j1"]]);
    expect(texts.map((t) => [t.type, t.key])).toEqual([["address_request", "address-request:v1:j1"], ["address_request_reminder", "address-request-reminder:v1:j1"]]);
    expect(texts[1]!.body).toBe("Home Insulation Victoria: reminder — we need your full address to check your home. Pick it here: https://estimate.homeinsulationvictoria.com.au/my-address/TOKEN123");
    expect(emails[1]!.text).toContain("Just a reminder — we need your full address to check your home.");
    expect(events("address_request_reminder_sent").length).toBe(1);

    expect(await at("2026-10-30T01:00:00.000Z")).toEqual({ sent: 0, reminded: 0 });
    expect(emails.length).toBe(2); expect(texts.length).toBe(2); expect(events("address_request_reminder_sent").length).toBe(1);
  });

  test("9pm Melbourne → email now, text held; 7:15am next day → the same text goes; still one event", async () => {
    expect(await at("2026-10-28T10:00:00.000Z")).toEqual({ sent: 1, reminded: 0 }); // 9pm AEDT
    expect(emails.length).toBe(1); expect(texts.length).toBe(0);
    expect(events("address_request_sent").length).toBe(1);
    expect(events("address_request_sent")[0]!["details"]).toMatchObject({ email: "sent", sms: { status: "blocked", detail: SMS_QUIET_REASON } });

    senderCalls.length = 0;
    await at("2026-10-28T11:00:00.000Z"); // 10pm: still quiet → the sender isn't even called
    expect(senderCalls).toEqual([]); expect(texts.length).toBe(0);

    await at("2026-10-28T20:15:00.000Z"); // 7:15am
    expect(texts.map((t) => [t.type, t.key])).toEqual([["address_request", "address-request:v1:j1"]]);
    expect(emails.length).toBe(1);
    expect(events("address_request_sent").length).toBe(1);

    senderCalls.length = 0;
    await at("2026-10-28T20:30:00.000Z");
    expect(senderCalls).toEqual([]); expect(texts.length).toBe(1);
  });

  test("both texts read right after the sender adds its brand line (no doubled brand)", async () => {
    await at("2026-10-28T01:00:00.000Z");
    await at("2026-10-29T01:00:00.000Z");
    expect(texts.map((t) => brandSmsBody(t.body))).toEqual([
      "Home Insulation Victoria: we need your full address to check your home. Pick it here: https://estimate.homeinsulationvictoria.com.au/my-address/TOKEN123",
      "Home Insulation Victoria: reminder — we need your full address to check your home. Pick it here: https://estimate.homeinsulationvictoria.com.au/my-address/TOKEN123",
    ]);
  });

  test("customer messages switched off → nothing logged (job stays to ask); switched on → asked and logged once", async () => {
    commsOn = false;
    expect(await at("2026-10-28T01:00:00.000Z")).toEqual({ sent: 0, reminded: 0 });
    expect(emails.length + texts.length).toBe(0);
    expect(events("address_request_sent").length).toBe(0);
    commsOn = true;
    expect(await at("2026-10-28T01:15:00.000Z")).toEqual({ sent: 1, reminded: 0 });
    expect(emails.length).toBe(1); expect(texts.length).toBe(1);
    expect(events("address_request_sent").length).toBe(1);
    expect(await at("2026-10-28T01:30:00.000Z")).toEqual({ sent: 0, reminded: 0 });
    expect(events("address_request_sent").length).toBe(1);
  });

  test("text switch off at 9pm with no email → not logged; the job is asked once the text can really go", async () => {
    (tables["jobs"]![0]!["owners"] as Row)["email"] = null;
    tables["workflow_settings"]![0]!["sms_message_switches"] = {};
    expect(await at("2026-10-28T10:00:00.000Z")).toEqual({ sent: 0, reminded: 0 }); // held for quiet hours, but the switch is off
    expect(events("address_request_sent").length).toBe(0);
    tables["workflow_settings"]![0]!["sms_message_switches"] = { address_request: true };
    expect(await at("2026-10-28T10:15:00.000Z")).toEqual({ sent: 1, reminded: 0 }); // quiet-hours hold that will go at 7am
    expect(events("address_request_sent").length).toBe(1);
    await at("2026-10-28T20:15:00.000Z");
    expect(texts.length).toBe(1);
  });

  test("55 older jobs with no owner link don't use up the batch: the newer good job is asked in the same tick", async () => {
    const base = tables["jobs"]![0]!;
    const older = Array.from({ length: 55 }, (_, n) => ({ ...base, id: `old-${String(n).padStart(2, "0")}`, created_at: `2026-10-21T00:${String(n).padStart(2, "0")}:00Z` }));
    for (const j of older) noLink.add(j.id);
    tables["jobs"] = [...older, base];
    expect(await at("2026-10-28T01:00:00.000Z")).toEqual({ sent: 1, reminded: 0 });
    expect(emails.map((e) => e.key)).toEqual(["address-request:v1:j1"]);
    expect(events("address_request_sent").map((e) => e["job_id"])).toEqual(["j1"]);
  });

  test("no usable owner link → skipped this tick (nothing logged), sent on a later tick", async () => {
    linkReady = false;
    expect(await at("2026-10-28T01:00:00.000Z")).toEqual({ sent: 0, reminded: 0 });
    expect(emails.length + texts.length + events("address_request_sent").length).toBe(0);
    linkReady = true;
    expect(await at("2026-10-28T01:15:00.000Z")).toEqual({ sent: 1, reminded: 0 });
  });

  test("not asked: has a street, feature off, before go-live, installer job, already answered", async () => {
    for (const s of [{ address: "12 Wattle St Brighton VIC 3186" }, { goLive: null }, { createdAt: "2026-10-01T00:00:00Z" }, { source: "portal" }]) {
      seed(s);
      expect(await at("2026-10-28T01:00:00.000Z")).toEqual({ sent: 0, reminded: 0 });
      expect(emails.length + texts.length).toBe(0);
    }
    seed();
    tables["workflow_events"]!.push({ id: "a", job_id: "j1", event_type: "address_request_answered", created_at: "2026-10-27T05:00:00Z" });
    expect(await at("2026-10-28T01:00:00.000Z")).toEqual({ sent: 0, reminded: 0 });
  });
});
