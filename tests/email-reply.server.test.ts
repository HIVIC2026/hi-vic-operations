// Decision 244: the reply drafter writes ONE Outlook draft per inbound email and never sends.
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
let linkReady = true;
mock.module("../src/lib/estimatelink.server", () => ({ adminLinkPath: async () => (linkReady ? "/estimate/TESTTOKEN" : null), ensureOwnerLink: async () => linkReady }));
// Decision 255: the existing guarded intake is faked at its boundary; everything else in email-enquiry.server is real.
type UpsertCall = { input: Row; source: string; origin: Row; opts: Row };
let upserts: UpsertCall[] = [];
const gate1: string[] = [];
mock.module("../src/lib/enquiry.server", () => ({
  upsertEnquiry: async (input: Row, source: string, _actor: null, origin: Row, opts: Row) => {
    upserts.push({ input, source, origin, opts });
    const id = `00000000-0000-0000-0000-00000000c${String(upserts.length).padStart(3, "0")}`, job_number = `HV-39${String(upserts.length).padStart(2, "0")}`;
    (tables["owners"] ??= []).push({ id: `owner-${id}`, email: input["email"], full_name: input["full_name"] });
    tables["jobs"]!.push({ id, job_number, owner_id: `owner-${id}`, stage: "new_enquiry", source, deleted_at: null, created_at: new Date().toISOString(),
      owners: { full_name: input["full_name"] }, properties: { suburb: input["suburb"] ?? null } });
    return { job_id: id, job_number, created: true, post_intake: "none" };
  },
}));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (job_id: string, actor_id: null, event_type: string, summary: string, details: Row, o: Row = {}) => { (tables["workflow_events"] ??= []).push({ id: crypto.randomUUID(), job_id, actor_id, event_type, summary, details, internal: o["internal"] ?? false }); },
}));
mock.module("../src/lib/eligibility.server", () => ({ autoDecideEligibility: async (id: string) => { gate1.push(`test:${id}`); return null; } }));
mock.module("../src/lib/postintake.server", () => ({ processPostIntakeWork: async (o: { jobId: string }) => { gate1.push(`live:${o.jobId}`); return {}; } }));
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
  calls = []; reads = 0; failEventInsert = false; createReplyStatus = 201; linkReady = true; upserts = []; gate1.length = 0;
}
const sendLike = (c: Call) => /\/(send|sendMail|reply|replyAll|forward)(\?|$)/i.test(c.url);
afterEach(() => expect(calls.some(sendLike)).toBe(false));

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
    expect(ev[0]!["details"]).toMatchObject({ message_id: m.providerMessageId, draft_id: "DRAFT-1", reply_type: "owner_status", would_auto_send: false, auto_send_built: false, check_before_sending: false });
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
  test("decision 255: unmatched new enquiry (TEST) → qa_test enquiry created via the guarded intake, homeowner page link, never the calculator", async () => {
    seed();
    const m = msg({ fromName: "JO TESTER", subject: "Ceiling insulation quote", body: "Hello, I'd like a quote for ceiling insulation for my house at 14 Example Street, Ringwood 3134. Mobile 0412 345 678.\n\nThanks,\nJo" });
    const r = await draftReplyForMessage({ message: m, mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toMatchObject({ status: "drafted", type: "new_enquiry", checkBeforeSending: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ source: "qa_test", origin: { channel: "hivic_sourced" }, opts: { emailIntake: true },
      input: { full_name: "Jo Tester", email: "jolowexo@hotmail.com", phone: "0412 345 678", address_line: "14 Example Street", suburb: "Ringwood", postcode: "3134", estimated_area_m2: null, area_unknown: true } });
    expect(gate1).toEqual([`test:${upserts.length && tables["jobs"]!.at(-1)!["id"]}`]); // TEST job: never the live post-intake queue
    const content = String(((calls[1]!.body!["body"]) as Row)["content"]);
    expect(content).toContain("Here's your own page: you can answer three quick questions and save your free spot:");
    expect(content).toContain("https://estimate.homeinsulationvictoria.com.au/estimate/TESTTOKEN/campaign");
    expect(content).not.toMatch(/homeinsulationvictoria\.com\.au\/(<|"|\s)/);
    expect(content).not.toContain("street address and suburb");
    expect(calls[1]!.body!["categories"]).toContain("Check before sending");
    const created = tables["workflow_events"]!.find((e) => e["event_type"] === "email_enquiry_created")!;
    expect(created["details"]).toMatchObject({ message_id: m.providerMessageId, source: "qa_test", address_found: true, consent_scope: "reply_to_this_email_only" });
    expect(String(created["summary"])).toContain("consent to reply to that email only");
    const drafted = tables["workflow_events"]!.find((e) => e["event_type"] === "email_reply_drafted")!;
    expect(drafted).toMatchObject({ job_id: created["job_id"] });
    expect(drafted["details"]).toMatchObject({ email_enquiry_created: true, link: "https://estimate.homeinsulationvictoria.com.au/estimate/TESTTOKEN/campaign" });
    expect(tables["owner_contact_consents"] ?? []).toHaveLength(0); // an email is consent to reply only
  });
  test("decision 255: no address in the email → reply asks for street address and suburb; enquiry has no address (Fix details)", async () => {
    seed();
    const r = await draftReplyForMessage({ message: msg({ subject: "Rebate", body: "Is the insulation rebate still available and how much would it cost?" }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toMatchObject({ status: "drafted", type: "price_rebate_eligibility", checkBeforeSending: true });
    expect(upserts[0]!.input).toMatchObject({ address_line: "", suburb: null, postcode: null, phone: null });
    const content = String(((calls[1]!.body!["body"]) as Row)["content"]);
    expect(content).toContain("Could you reply with your home&#39;s street address and suburb".replace("&#39;", "'"));
    expect(content).toContain("/estimate/TESTTOKEN/campaign");
  });
  test("decision 255: the email is already an owner's → linked to their job, no new enquiry", async () => {
    seed();
    tables["owners"]!.push({ id: "owner-qa", email: "jolowexo@hotmail.com" });
    tables["jobs"]![0]!["owner_id"] = "owner-qa";
    const r = await draftReplyForMessage({ message: msg({ subject: "Quote", body: "Hi, I'd like a quote for ceiling insulation please." }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(upserts).toHaveLength(0);
    expect(r).toMatchObject({ status: "drafted" });
    expect(tables["workflow_events"]!.find((e) => e["event_type"] === "email_reply_drafted")).toMatchObject({ job_id: J_QA });
  });
  test("decision 255: linked to a REAL owner's job in TEST mode → no draft", async () => {
    seed();
    tables["owners"]!.push({ id: "owner-real", email: "jolowexo@hotmail.com" });
    tables["jobs"]![1]!["owner_id"] = "owner-real";
    const r = await draftReplyForMessage({ message: msg({ subject: "Quote", body: "Hi, I'd like a quote for ceiling insulation please." }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toMatchObject({ status: "skipped", reason: "TEST mode: only qa_test jobs get reply drafts" });
    expect(calls).toHaveLength(0);
  });
  test("decision 255: same email seen again reuses the enquiry it created (no second job)", async () => {
    seed(); createReplyStatus = 500; // first draft fails after the enquiry is made
    const m = msg({ subject: "Quote", body: "Hi, I'd like a quote for ceiling insulation please." });
    expect((await draftReplyForMessage({ message: m, mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON })).status).toBe("skipped");
    createReplyStatus = 201; calls = [];
    const r = await draftReplyForMessage({ message: m, mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toMatchObject({ status: "drafted", type: "new_enquiry" });
    expect(upserts).toHaveLength(1);
  });
  test("decision 255: homeowner page not ready → draft has no link (never the calculator) and is flagged", async () => {
    seed(); linkReady = false;
    const r = await draftReplyForMessage({ message: msg({ subject: "Quote", body: "Hi, I'd like a quote for ceiling insulation please." }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r).toMatchObject({ status: "drafted", checkBeforeSending: true });
    const content = String(((calls[1]!.body!["body"]) as Row)["content"]);
    expect(content).not.toContain("https://");
    expect(content).toContain("We&#39;ll send you your own page".replace("&#39;", "'"));
  });
  test("decision 255: a sender off the TEST allow-list never gets an enquiry created", async () => {
    seed();
    const r = await draftReplyForMessage({ message: msg({ from: "stranger@example.org", subject: "Quote", body: "I'd like a quote for ceiling insulation" }), mailbox: MAILBOX, jobIds: [], origin: "unmatched", now, switches: ON });
    expect(r.status).toBe("skipped");
    expect(upserts).toHaveLength(0);
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

test("source guards: no sender is reachable from the drafter, and the copier wires it behind the switch", () => {
  const src = readFileSync("src/lib/email-reply.server.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");
  expect(src).not.toMatch(/sendMail|\/send["'`]|sendRealSms|sendGuardedOwnerEmail|sendOfficeEmail|test-send\.server|owner-email-send/);
  expect(src).toContain("assertDraftOnlyRequest(method, path)");
  const sync = readFileSync("src/lib/outlook-sync.server.ts", "utf8");
  expect(sync).toContain("if (!EMAIL_REPLY_DRAFTS_ENABLED || m.direction !== \"inbound\") return null;");
  expect(sync).toContain("await draftReply(filed, mailbox, [jobId], \"office_matched\")");
  expect(sync).toContain("await draftReply(work.message, work.mailbox, routeJobIds(work.route), \"sync\")");
  expect(sync).toContain("await draftReply(m, mailbox, [], \"unmatched\")");
});
