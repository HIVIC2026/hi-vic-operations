// Decision 244: the reply drafter writes ONE Outlook draft per inbound email and never sends.
// Decision 292 (replaces 255): an unmatched NEW sender gets no draft and NO enquiry created from their email.
// The database is an in-memory fake; Outlook is a recorded fake fetch. Nothing touches a live service.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { MailMessage } from "../src/lib/outlook-correspondence.core";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
let reads = 0;
let failEventInsert = false;
const get = (r: Row, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o == null ? o : (o as Row)[k]), r);
const subset = (a: unknown, b: unknown): boolean => {
  if (b && typeof b === "object" && !Array.isArray(b)) return !!a && typeof a === "object" && Object.entries(b as Row).every(([k, v]) => subset((a as Row)[k], v));
  return a === b;
};
function fakeAdmin() {
  return {
    from(table: string) {
      let op: "select" | "insert" = "select"; let payload: Row | null = null; let lim = Infinity; let one: "one" | "maybe" | null = null;
      const preds: ((r: Row) => boolean)[] = [];
      const b = {
        select() { return b; },
        eq(c: string, v: unknown) { preds.push((r) => get(r, c) === v); return b; },
        neq(c: string, v: unknown) { preds.push((r) => get(r, c) !== v); return b; },
        in(c: string, v: unknown[]) { preds.push((r) => v.includes(get(r, c))); return b; },
        is(c: string, v: null) { preds.push((r) => (get(r, c) ?? null) === v); return b; },
        ilike(c: string, v: string) { preds.push((r) => String(get(r, c) ?? "").toLowerCase() === v.toLowerCase()); return b; },
        contains(c: string, v: unknown) { preds.push((r) => subset(get(r, c), v)); return b; },
        order() { return b; },
        limit(n: number) { lim = n; return b; },
        maybeSingle() { one = "maybe"; return b; },
        single() { one = "one"; return b; },
        insert(p: Row) { op = "insert"; payload = p; return b; },
        then(res: (v: { data: unknown; error: { message: string; code?: string } | null }) => unknown, rej?: (e: unknown) => unknown) {
          let out: { data: unknown; error: { message: string; code?: string } | null };
          if (op === "insert") {
            if (table === "workflow_events" && failEventInsert) out = { data: null, error: { message: "insert refused", code: "42501" } };
            else { (tables[table] ??= []).push({ id: crypto.randomUUID(), ...payload! }); out = { data: null, error: null }; }
          } else {
            reads++;
            const rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r))).slice(0, lim);
            out = { data: one ? rows[0] ?? null : rows, error: null };
          }
          return Promise.resolve(out).then(res, rej);
        },
      };
      return b;
    },
  };
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin() }));
mock.module("../src/lib/payments.server", () => ({ jobPaymentView: async () => null }));
mock.module("../src/lib/estimatelink.server", () => ({ adminLinkPath: async () => "/estimate/TESTTOKEN", ensureOwnerLink: async () => true }));
// Decision 292: the intake must never be reached from the drafter. If it is, the test fails loudly.
mock.module("../src/lib/enquiry.server", () => ({ upsertEnquiry: async () => { throw new Error("upsertEnquiry must not be called by the reply drafter (decision 292)"); } }));
mock.module("../src/lib/trade-view.server", () => ({ partnerPayStates: async () => [] }));
process.env["LOVABLE_API_KEY"] = "test-lovable";
process.env["MICROSOFT_OUTLOOK_API_KEY"] = "test-outlook";

type Call = { method: string; url: string; body: Row | null; headers: Record<string, string> };
let calls: Call[] = [];
let createReplyStatus = 201;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  const body = init.body ? JSON.parse(String(init.body)) as Row : null;
  calls.push({ method: String(init.method), url: String(url), body, headers: init.headers as Record<string, string> });
  const u = String(url);
  if (init.method === "POST" && u.endsWith("/createReply")) return createReplyStatus === 201
    ? new Response(JSON.stringify({ id: "DRAFT-1", isDraft: true, body: { contentType: "html", content: "<div>quoted thread</div>" } }), { status: 201 })
    : new Response("{}", { status: createReplyStatus });
  if (init.method === "POST") return new Response(JSON.stringify({ id: "DRAFT-NEW", isDraft: true }), { status: 201 });
  if (init.method === "PATCH") return new Response(JSON.stringify({ id: "DRAFT-1" }), { status: 200 });
  if (init.method === "DELETE") return new Response(null, { status: 204 });
  return new Response("{}", { status: 500 });
}) as typeof fetch;

const { draftReplyForMessage } = await import("../src/lib/email-reply.server");

const MAILBOX = "info@homeinsulationvictoria.com.au";
const ON = { enabled: true, testOnly: true };
const J_QA = "00000000-0000-0000-0000-0000000000a1", J_REAL = "00000000-0000-0000-0000-0000000000b2";
const now = new Date("2026-10-24T00:00:00Z");
const msg = (o: Partial<MailMessage> = {}): MailMessage => ({
  providerMessageId: `AAMk-${crypto.randomUUID()}`, threadId: "thread-1", internetMessageId: "<m1@example.com>", direction: "inbound",
  from: "jolowexo@hotmail.com", fromName: "Jo Tester", to: [MAILBOX], cc: [], subject: "Re: Your spot is saved HV-3150",
  body: "Hi, when is my free Ready Check? Thanks", at: "2026-10-23T22:00:00Z", hasAttachments: false, attachments: [], ...o,
});
function seed() {
  for (const k of Object.keys(tables)) delete tables[k];
  tables["jobs"] = [
    { id: J_QA, job_number: "HV-3150", stage: "ready_check_scheduled", source: "qa_test", deleted_at: null, owners: { full_name: "Helen Sample" }, properties: { suburb: "Glen Waverley" } },
    { id: J_REAL, job_number: "HV-3151", stage: "ready_check_scheduled", source: "website", deleted_at: null, owners: { full_name: "Real Owner" }, properties: { suburb: "Ringwood" } },
  ];
  tables["bookings"] = [{ job_id: J_QA, kind: "ready_check", status: "confirmed", scheduled_start: "2026-10-27T22:00:00Z", scheduled_end: "2026-10-28T00:00:00Z" }];
  tables["quotes"] = []; tables["indicative_estimates"] = []; tables["lead_campaign_responses"] = []; tables["businesses"] = [];
  tables["workflow_events"] = []; tables["partner_offers"] = []; tables["job_assignments"] = [];
  tables["owners"] = [];
  calls = []; reads = 0; failEventInsert = false; createReplyStatus = 201;
}
const sendLike = (c: Call) => /\/(send|sendMail|reply|replyAll|forward)(\?|$)/i.test(c.url);
afterEach(() => expect(calls.some(sendLike)).toBe(false));
/** Decision 292: whatever happens, the drafter creates no job, owner or enquiry event. */
const noEnquiryCreated = () => {
  expect(tables["jobs"]).toHaveLength(2);
  expect(tables["owners"] ?? []).toHaveLength(0);
  expect(tables["workflow_events"]!.filter((e) => e["event_type"] === "email_enquiry_created")).toHaveLength(0);
  expect(tables["owner_contact_consents"] ?? []).toHaveLength(0);
};

describe("switches", () => {
  test("default (EMAIL_REPLY_DRAFTS_ENABLED = false): nothing read, drafted or recorded", async () => {
    seed();
    const r = await draftReplyForMessage({ message: msg(), mailbox: MAILBOX, jobIds: [J_QA], origin: "sync", now });
    expect(r).toEqual({ status: "skipped", reason: "Reply drafts are switched off (EMAIL_REPLY_DRAFTS_ENABLED)" });
    expect([calls.length, reads, tables["workflow_events"]!.length]).toEqual([0, 0, 0]);
  });
  test("TEST mode: a sender off the allow-list gets no draft", async () => {
    seed();
    const r = await draftReplyForMessage({ message: msg({ from: "helen.sample@example.com" }), mailbox: MAILBOX, jobIds: [J_QA], origin: "sync", now, switches: ON });
    expect(r.status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
  test("TEST mode: a real (non-qa_test) job gets no draft, even from the allow-list", async () => {
    seed();
    const r = await draftReplyForMessage({ message: msg(), mailbox: MAILBOX, jobIds: [J_REAL], origin: "sync", now, switches: ON });
    expect(r).toMatchObject({ status: "skipped", reason: "TEST mode: only qa_test jobs get reply drafts" });
    expect(calls).toHaveLength(0);
  });
});

describe("drafting", () => {
  test("createReply in the same thread, then PATCH the body above the quoted thread; one event; idempotent", async () => {
    seed();
    const m = msg();
    const r = await draftReplyForMessage({ message: m, mailbox: MAILBOX, jobIds: [J_QA], origin: "sync", now, switches: ON });
    expect(r).toMatchObject({ status: "drafted", draftId: "DRAFT-1", type: "owner_status", method: "createReply" });
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^https:\/\/connector-gateway\.lovable\.dev\/microsoft_outlook/, "")}`)).toEqual([
      `POST /users/info%40homeinsulationvictoria.com.au/messages/${encodeURIComponent(m.providerMessageId)}/createReply`,
      "PATCH /users/info%40homeinsulationvictoria.com.au/messages/DRAFT-1",
    ]);
    const patch = calls[1]!;
    const content = String((patch.body!["body"] as Row)["content"]);
    expect(content).toContain("<p>Hi Helen,</p>");
    expect(content).toContain("Your free Ready Check is booked for Wednesday 28 October at 9am.");
    expect(content.endsWith("<div>quoted thread</div>")).toBe(true);
    expect(patch.body!["categories"]).toContain("Portal draft");
    expect(patch.headers["X-Connection-Api-Key"]).toBe("test-outlook");
    expect(patch.headers["Prefer"]).toContain("ImmutableId");
    const ev = tables["workflow_events"]!;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ job_id: J_QA, event_type: "email_reply_drafted", internal: true });
    expect(ev[0]!["details"]).toMatchObject({ message_id: m.providerMessageId, draft_id: "DRAFT-1", reply_type: "owner_status", would_auto_send: false, auto_send_built: false, check_before_sending: false, email_enquiry_created: false });
    calls = [];
    const again = await draftReplyForMessage({ message: m, mailbox: MAILBOX, jobIds: [J_QA], origin: "office_matched", now, switches: ON });
    expect(again).toEqual({ status: "skipped", reason: "A reply draft already exists for this email" });
    expect(calls).toHaveLength(0);
    expect(tables["workflow_events"]).toHaveLength(1);
  });
  test("createReply not available → a new DRAFT message to the sender (POST /messages), never a send", async () => {
    seed(); createReplyStatus = 405;
    const r = await draftReplyForMessage({ message: msg(), mailbox: MAILBOX, jobIds: [J_QA], origin: "sync", now, switches: ON });
    expect(r).toMatchObject({ status: "drafted", draftId: "DRAFT-NEW", method: "new_message" });
    const fresh = calls[1]!;
    expect(fresh.url.endsWith("/users/info%40homeinsulationvictoria.com.au/messages")).toBe(true);
    expect(fresh.body!["toRecipients"]).toEqual([{ emailAddress: { address: "jolowexo@hotmail.com" } }]);
    expect(fresh.body!["subject"]).toBe("Re: Your spot is saved HV-3150");
  });
  test("if the record can't be written the draft is removed (no draft without its idempotency record)", async () => {
    seed(); failEventInsert = true;
    const r = await draftReplyForMessage({ message: msg(), mailbox: MAILBOX, jobIds: [J_QA], origin: "sync", now, switches: ON });
    expect(r.status).toBe("skipped");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE" });
    expect(calls.at(-1)!.url.endsWith("/messages/DRAFT-1")).toBe(true);
  });
  test("decision 292: an unmatched new enquiry (even from the allow-list, with a full address) creates NO enquiry and gets no draft", async () => {
    seed();
    const m = msg({ fromName: "JO TESTER", subject: "Ceiling insulation quote", body: "Hello, I'd like a quote for ceiling insulation for my house at 14 Example Street, Ringwood 3134. Mobile 0412 345 678.\n\nThanks,\nJo" });
    const r = await draftReplyForMessage({ message: m, mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toEqual({ status: "skipped", reason: "Unmatched email — drafted after the office matches it" });
    expect(calls).toHaveLength(0);
    noEnquiryCreated();
    expect(tables["workflow_events"]).toHaveLength(0);
  });
  test("decision 292: an unmatched price / rebate question creates NO enquiry and gets no draft", async () => {
    seed();
    const r = await draftReplyForMessage({ message: msg({ subject: "Rebate", body: "Is the insulation rebate still available and how much would it cost?" }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toMatchObject({ status: "skipped", reason: "Unmatched email — drafted after the office matches it" });
    expect(calls).toHaveLength(0);
    noEnquiryCreated();
  });
  test("decision 292: an unmatched email from an address that IS already an owner's is not linked by the drafter either (the office matches it)", async () => {
    seed();
    tables["owners"]!.push({ id: "owner-qa", email: "jolowexo@hotmail.com" });
    tables["jobs"]![0]!["owner_id"] = "owner-qa";
    const r = await draftReplyForMessage({ message: msg({ subject: "Quote", body: "Hi, I'd like a quote for ceiling insulation please." }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toMatchObject({ status: "skipped", reason: "Unmatched email — drafted after the office matches it" });
    expect(calls).toHaveLength(0);
    expect(tables["workflow_events"]).toHaveLength(0);
    expect(tables["jobs"]).toHaveLength(2);
  });
  test("decision 292: a sender off the TEST allow-list never gets an enquiry created", async () => {
    seed();
    const r = await draftReplyForMessage({ message: msg({ from: "stranger@example.org", subject: "Quote", body: "I'd like a quote for ceiling insulation" }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r.status).toBe("skipped");
    noEnquiryCreated();
  });
  test("unmatched mail that isn't an enquiry waits for the office's Match", async () => {
    seed();
    const r = await draftReplyForMessage({ message: msg({ subject: "Invoice", body: "Please find our invoice attached." }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toMatchObject({ status: "skipped", reason: "Unmatched email — drafted after the office matches it" });
    expect(calls).toHaveLength(0);
  });
  test("outbound and old mail never get drafts", async () => {
    seed();
    expect((await draftReplyForMessage({ message: msg({ direction: "outbound" }), mailbox: MAILBOX, jobIds: [J_QA], origin: "sync", now, switches: ON })).status).toBe("skipped");
    expect((await draftReplyForMessage({ message: msg({ at: "2026-09-01T00:00:00Z" }), mailbox: MAILBOX, jobIds: [J_QA], origin: "sync", now, switches: ON })).status).toBe("skipped");
    expect(calls).toHaveLength(0);
  });
});

test("source guards: no sender or intake is reachable from the drafter, and the copier wires it behind the switch", () => {
  const src = readFileSync("src/lib/email-reply.server.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  expect(src).not.toMatch(/sendMail|\/send["'`]|sendRealSms|sendGuardedOwnerEmail|sendOfficeEmail|test-send\.server|owner-email-send/);
  expect(src).not.toMatch(/email-enquiry|upsertEnquiry|enquiryFromEmail|ensureOwnerLink/); // decision 292
  expect(src).toContain("assertDraftOnlyRequest(method, path)");
  const sync = readFileSync("src/lib/outlook-sync.server.ts", "utf8");
  expect(sync).toContain("if (!EMAIL_REPLY_DRAFTS_ENABLED || m.direction !== \"inbound\") return null;");
  expect(sync).toContain("await draftReply(filed, mailbox, [jobId], \"office_matched\")");
  expect(sync).toContain("await draftReply(work.message, work.mailbox, routeJobIds(work.route), \"sync\")");
  expect(sync).toContain("await draftReply(m, mailbox, [], \"unmatched\")");
});
