// Decision 292: the website reply server — one job-less record per reply, once per sender ever, test-send for the TEST
// allow-list, the live owner-email sender only when approved + TEST mode off + comms on + recipient boundary allows.
// The database is an in-memory fake (with the live-claim unique key); both senders are recorded fakes.
import { afterEach, describe, expect, mock, test } from "bun:test";
import type { MailMessage } from "../src/lib/outlook-correspondence.core";
import { HELD_COMMS_OFF, HELD_TEST_ONLY, HELD_UNAPPROVED, NEW_SENDER_REPLIED_EVENT, SKIP_ALREADY_REPLIED, newSenderReplyKey } from "../src/lib/new-sender-reply.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let reads = 0;
let eventInsertError: { message: string; code: string } | null = null;
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const subset = (a: unknown, b: unknown): boolean => {
  if (b && typeof b === "object" && !Array.isArray(b)) return !!a && typeof a === "object" && Object.entries(b as Row).every(([k, v]) => subset((a as Row)[k], v));
  return a === b;
};
function fakeAdmin() {
  return {
    from(table: string) {
      let op: "select" | "insert" = "select"; let payload: Row | null = null; let lim = Infinity;
      const preds: ((r: Row) => boolean)[] = [];
      const b = {
        select() { return b; },
        eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
        ilike(c: string, v: string) { preds.push((r) => String(get(r, c) ?? "").toLowerCase() === v.toLowerCase()); return b; },
        contains(c: string, v: unknown) { preds.push((r) => subset(get(r, c), v)); return b; },
        limit(n: number) { lim = n; return b; },
        maybeSingle() { return b; },
        insert(p: Row) { op = "insert"; payload = p; return b; },
        then(res: (v: { data: unknown; error: { message: string; code?: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
          let out: { data: unknown; error: { message: string; code?: string } | null };
          if (op === "insert") {
            const det = (payload?.["details"] ?? {}) as Row;
            if (table === "workflow_events" && eventInsertError) out = { data: null, error: eventInsertError };
            else if (table === "workflow_events" && det["mode"] === "live" && (tables[table] ?? []).some((r) => (r["details"] as Row)?.["mode"] === "live" && (r["details"] as Row)?.["idempotency_key"] === det["idempotency_key"]))
              out = { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
            else { (tables[table] ??= []).push({ id: crypto.randomUUID(), ...payload! }); out = { data: null, error: null }; }
          } else {
            reads++;
            out = { data: (tables[table] ?? []).filter((r) => preds.every((p) => p(r))).slice(0, lim), error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
let commsEnabled = false; let commsReads = 0;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => { commsReads++; return commsEnabled; } }));
type TestSend = { ctx: Row; to: string; subject: string; html: string; text: string };
let testSends: TestSend[] = []; let testSendStatus: "sent" | "blocked" = "sent";
mock.module("../src/lib/test-send.server", () => ({
  sendTestEmail: async (ctx: Row, to: string, subject: string, html: string, text: string) => { testSends.push({ ctx, to, subject, html, text }); return { channel: "email", to, status: testSendStatus, detail: testSendStatus === "sent" ? "Resend accepted (id t1)" : "Recipient is not on the test allowlist" }; },
}));
type LiveSend = { to: string; subject: string; html: string; text: string; idem: string; unsubscribe: string | null };
let liveSends: LiveSend[] = []; let liveOutcome: "accepted" | "uncertain" | "rejected" | "not_attempted" = "accepted";
mock.module("../src/lib/hot-leads-send.server", () => ({
  resendSend: async (to: string, subject: string, html: string, text: string, idem: string, unsubscribe: string | null) => {
    liveSends.push({ to, subject, html, text, idem, unsubscribe });
    return liveOutcome === "accepted" ? { outcome: "accepted", id: "re_1", detail: "Accepted" } : { outcome: liveOutcome, detail: `Email service ${liveOutcome}` };
  },
}));
// The real non-production recipient boundary (comms-test-recipient.core), driven by its env vars: production by default
// here, non-production with an empty allow-list in the "boundary blocks" test.
const setProduction = (on: boolean) => { process.env["HIVIC_COM04_ENV"] = on ? "production" : "nonproduction"; delete process.env["HIVIC_COM04_TEST_RECIPIENTS"]; };

const { replyToNewSender } = await import("../src/lib/new-sender-reply.server");

const MAILBOX = "info@homeinsulationvictoria.com.au";
const now = new Date("2026-10-25T00:00:00Z");
const msg = (o: Partial<MailMessage> = {}): MailMessage => ({
  providerMessageId: `AAMk-${crypto.randomUUID()}`, threadId: "thread-1", internetMessageId: "<m1@example.com>", direction: "inbound",
  from: "new.person@example.org", fromName: "Sam Person", to: [MAILBOX], cc: [], subject: "Ceiling insulation quote",
  body: "Hi, I'd like a quote for ceiling insulation for my house. How much is the rebate?\n\nThanks", at: "2026-10-24T22:00:00Z", hasAttachments: false, attachments: [], ...o,
});
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["owners"] = [{ id: "o1", email: "helen.sample@example.com" }];
  tables["businesses"] = [{ id: "b1", email: "dan@sampleinsulation.example", signer_email: "boss@sampleinsulation.example" }];
  tables["partner_workers"] = [{ id: "w1", email: "crew@sampleinsulation.example" }];
  tables["partner_enquiries"] = [{ id: "pe1", email: "applicant@newtrade.example" }];
  tables["profiles"] = [{ id: "s1", email: "chris.staff@gmail.example" }];
  tables["workflow_events"] = []; tables["admin_config_events"] = [];
  reads = 0; eventInsertError = null; commsEnabled = false; commsReads = 0; testSends = []; testSendStatus = "sent"; liveSends = []; liveOutcome = "accepted"; setProduction(true);
}
const events = () => tables["workflow_events"]!.filter((e) => e["event_type"] === NEW_SENDER_REPLIED_EVENT);
const LIVE = { approved: true, testOnly: false };
afterEach(() => {
  delete process.env["HIVIC_COM04_ENV"];
  for (const e of tables["workflow_events"] ?? []) { expect(e["job_id"] ?? null).toBeNull(); expect(e["event_type"]).toBe(NEW_SENDER_REPLIED_EVENT); }
  expect(tables["jobs"]).toBeUndefined(); // never an enquiry
  expect(tables["owners"]!.length).toBe(1);
});

describe("defaults: approved wording, TEST mode", () => {
  test("a real new sender is held (not on the allow-list) — nothing recorded, nothing sent, no sender module touched", async () => {
    seed();
    expect(await replyToNewSender(msg(), { mailbox: MAILBOX, now })).toEqual({ status: "held", reason: HELD_TEST_ONLY });
    expect([events().length, testSends.length, liveSends.length, commsReads]).toEqual([0, 0, 0, 0]);
  });
  test("the allow-listed sender (Jo) gets the TEST copy through test-send, recorded once per message", async () => {
    seed();
    const m = msg({ from: "jolowexo@hotmail.com", fromName: "Jo Tester", subject: "Price?" });
    expect(await replyToNewSender(m, { mailbox: MAILBOX, now })).toMatchObject({ status: "sent", mode: "test" });
    expect(testSends).toHaveLength(1);
    expect(testSends[0]).toMatchObject({ to: "jolowexo@hotmail.com", subject: "Re: Price?", ctx: { jobId: null, jobSource: null, partnerIsTest: true, label: "new_sender_reply:O70", actorId: null } });
    expect(testSends[0]!.html).toContain("TEST — only sent to Jo");
    expect(testSends[0]!.html).toContain(">Hi Jo,</p>");
    expect(testSends[0]!.html).toContain('href="https://estimate.homeinsulationvictoria.com.au/"');
    expect(liveSends).toHaveLength(0);
    expect(events()).toHaveLength(1);
    expect(events()[0]!["details"]).toMatchObject({ mode: "test", from: "jolowexo@hotmail.com", message_id: m.providerMessageId, delivery: "sent", template: "O70" });
    expect(await replyToNewSender(m, { mailbox: MAILBOX, now })).toMatchObject({ status: "skipped", reason: "A test reply was already sent for this email" });
    expect(await replyToNewSender(msg({ from: "jolowexo@hotmail.com" }), { mailbox: MAILBOX, now })).toMatchObject({ status: "sent", mode: "test" });
    expect(testSends).toHaveLength(2);
  });
  test("a blocked test send is held, not recorded as a reply", async () => {
    seed(); testSendStatus = "blocked";
    expect(await replyToNewSender(msg({ from: "jolowexo@hotmail.com" }), { mailbox: MAILBOX, now })).toMatchObject({ status: "held", reason: "Test send blocked: Recipient is not on the test allowlist" });
    expect(events()).toHaveLength(0);
  });
  test("unapproved → held for everyone, Jo included", async () => {
    seed();
    expect(await replyToNewSender(msg({ from: "jolowexo@hotmail.com" }), { mailbox: MAILBOX, now, switches: { approved: false, testOnly: true } })).toEqual({ status: "held", reason: HELD_UNAPPROVED });
    expect([events().length, testSends.length]).toEqual([0, 0]);
  });
});

describe("skips (nothing recorded)", () => {
  test("junk, bounce, mailing-list, outbound and old mail are decided before any read", async () => {
    seed();
    for (const m of [msg({ from: "no-reply@shop.example" }), msg({ from: "mailer-daemon@mx.example" }), msg({ from: "bounces+x@list.example" }), msg({ direction: "outbound" }),
      msg({ at: "2026-09-01T00:00:00Z" }), msg({ subject: "Automatic reply: hi" }), msg({ body: "Insulation rebate deals! Click here to unsubscribe from our list." })])
      expect((await replyToNewSender(m, { mailbox: MAILBOX, now, switches: LIVE })).status).toBe("skipped");
    expect([reads, tables["workflow_events"]!.length]).toEqual([0, 0]);
  });
  test("owner, partner business, business signer, partner worker, partner applicant, staff → skipped", async () => {
    seed(); commsEnabled = true;
    const cases: [string, RegExp][] = [["Helen.Sample@example.com", /already an owner/], ["dan@sampleinsulation.example", /partner/], ["boss@sampleinsulation.example", /partner/],
      ["crew@sampleinsulation.example", /partner/], ["applicant@newtrade.example", /partner/], ["chris.staff@gmail.example", /staff/]];
    for (const [from, re] of cases) expect(await replyToNewSender(msg({ from }), { mailbox: MAILBOX, now, switches: LIVE })).toMatchObject({ status: "skipped", reason: expect.stringMatching(re) });
    expect([tables["workflow_events"]!.length, testSends.length, liveSends.length]).toEqual([0, 0, 0]);
  });
  test("a status question or an invoice is not an enquiry → skipped", async () => {
    seed();
    expect(await replyToNewSender(msg({ subject: "Insulation at 1 Fixture Road", body: "I manage 1 Fixture Road for the owner — when is the inspection?" }), { mailbox: MAILBOX, now, switches: LIVE })).toMatchObject({ status: "skipped", reason: expect.stringContaining("Not an enquiry") });
    expect(tables["workflow_events"]).toHaveLength(0);
  });
});

describe("approved and live (TEST mode off)", () => {
  test("comms off → held (switch consulted once), nothing recorded or sent", async () => {
    seed(); commsEnabled = false;
    expect(await replyToNewSender(msg(), { mailbox: MAILBOX, now, switches: LIVE })).toEqual({ status: "held", reason: HELD_COMMS_OFF });
    expect([commsReads, liveSends.length, events().length]).toEqual([1, 0, 0]);
  });
  test("non-production recipient boundary blocks → held, the sender's claim is not used up", async () => {
    seed(); commsEnabled = true; setProduction(false);
    // example.org is an RFC test domain (always allowed); a real-looking address with no allow-list is blocked.
    expect(await replyToNewSender(msg({ from: "sam.person@gmail.com" }), { mailbox: MAILBOX, now, switches: LIVE })).toMatchObject({ status: "held", reason: expect.stringContaining("Non-production test boundary is active") });
    expect([liveSends.length, events().length]).toEqual([0, 0]);
  });
  test("comms on → the claim is recorded first, then ONE email through the live owner-email sender with the per-sender key; delivery logged", async () => {
    seed(); commsEnabled = true;
    const m = msg();
    expect(await replyToNewSender(m, { mailbox: MAILBOX, now, switches: LIVE })).toMatchObject({ status: "sent", mode: "live", detail: "Accepted" });
    expect(liveSends).toHaveLength(1);
    expect(liveSends[0]).toMatchObject({ to: "new.person@example.org", subject: "Re: Ceiling insulation quote", idem: newSenderReplyKey("new.person@example.org"), unsubscribe: null });
    expect(liveSends[0]!.html).toContain(">Hi Sam,</p>");
    expect(liveSends[0]!.html).not.toContain("TEST — only sent to Jo");
    expect(liveSends[0]!.text).toContain("— Home Insulation Victoria");
    expect(testSends).toHaveLength(0);
    expect(events()).toHaveLength(1);
    expect(events()[0]!["details"]).toMatchObject({ mode: "live", from: "new.person@example.org", provider: "resend", idempotency_key: newSenderReplyKey("new.person@example.org"), message_id: m.providerMessageId });
    expect(tables["admin_config_events"]!.map((e) => [e["event_type"], (e["details"] as Row)["outcome"], (e["details"] as Row)["provider_message_id"]])).toEqual([["new_sender_reply_delivery", "accepted", "re_1"]]);
    // One reply per sender, ever: another email from the same address (any spelling) sends nothing more.
    expect(await replyToNewSender(msg({ from: "New.Person@Example.org", subject: "Still waiting", body: "How much would ceiling insulation cost for us?" }), { mailbox: MAILBOX, now, switches: LIVE }))
      .toMatchObject({ status: "skipped", reason: SKIP_ALREADY_REPLIED });
    expect([liveSends.length, events().length]).toEqual([1, 1]);
  });
  test("a concurrent claim (unique key refuses the insert) → skipped, nothing sent", async () => {
    seed(); commsEnabled = true;
    // Another copier run claimed this sender between our read and our insert: the read misses it, the insert is refused.
    tables["workflow_events"]!.push({ id: "x", job_id: null, event_type: NEW_SENDER_REPLIED_EVENT, details: { mode: "live", idempotency_key: newSenderReplyKey("new.person@example.org"), from: "someone-else" } });
    expect(await replyToNewSender(msg(), { mailbox: MAILBOX, now, switches: LIVE })).toEqual({ status: "skipped", reason: SKIP_ALREADY_REPLIED });
    expect(liveSends).toHaveLength(0);
  });
  test("a definite refusal from the email service is reported as held; the sender keeps their one claim (never retried)", async () => {
    seed(); commsEnabled = true; liveOutcome = "rejected";
    expect(await replyToNewSender(msg(), { mailbox: MAILBOX, now, switches: LIVE })).toMatchObject({ status: "held", reason: "Send failed: Email service rejected" });
    expect([events().length, liveSends.length]).toEqual([1, 1]);
    expect(await replyToNewSender(msg(), { mailbox: MAILBOX, now, switches: LIVE })).toMatchObject({ status: "skipped" });
    expect(liveSends).toHaveLength(1);
  });
  test("an uncertain delivery counts as sent (never retried)", async () => {
    seed(); commsEnabled = true; liveOutcome = "uncertain";
    expect(await replyToNewSender(msg(), { mailbox: MAILBOX, now, switches: LIVE })).toMatchObject({ status: "sent", mode: "live" });
    expect(tables["admin_config_events"]![0]!["summary"]).toContain("delivery uncertain");
  });
  test("pending migration not applied (job-less insert refused) → nothing sent", async () => {
    seed(); commsEnabled = true; eventInsertError = { message: "violates check constraint workflow_events_job_required", code: "23514" };
    expect(await replyToNewSender(msg(), { mailbox: MAILBOX, now, switches: LIVE })).toMatchObject({ status: "skipped", reason: expect.stringContaining("pending migration") });
    expect(liveSends).toHaveLength(0);
    expect(tables["workflow_events"]).toHaveLength(0);
  });
});

