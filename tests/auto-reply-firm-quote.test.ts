// Firm-quote owners never get an automatic spot answer: the AI leaves an office draft on the job instead.
import { describe, expect, mock, test } from "bun:test";
import { decideOwnerAutoReply, EMAIL_AUTO_REPLIED_EVENT, REPLY_NEEDED_INTENT, renderOwnerAutoReplyEmail, type AutoReplyInput, type OwnerJobFacts } from "../src/lib/owner-email-auto-reply.core";

const MY_JOB = "https://estimate.homeinsulationvictoria.com.au/my-job/tokreal";
const facts = (o: Partial<OwnerJobFacts> = {}): OwnerJobFacts => ({
  stage: "preliminary_estimate_ready", ownerFullName: "Helen Yang", spotSaved: false, questionsAnswered: false, nextVisit: null, quoteStatus: null,
  myJobLink: MY_JOB, questionsLink: "https://estimate.homeinsulationvictoria.com.au/estimate/tokreal/video", ...o,
});
const input = (body: string, job: OwnerJobFacts, o: Partial<AutoReplyInput> = {}): AutoReplyInput => ({
  subject: "Re: Your estimate", body, fromName: "Helen", hasAttachments: false, attachments: [], jobCount: 1, senderIsOwner: true, senderIsPartnerOrStaff: false, job, ...o,
});
const QUESTIONS = ["Hi, is my spot saved?", "Hi, what happens next?", "Did my request go through?", "How do I save my spot?"];

describe("core decision", () => {
  test("firm job before Proceed: no auto-send, draft left", () => {
    for (const body of QUESTIONS) {
      const d = decideOwnerAutoReply(input(body, facts(), { isFirmQuote: true }));
      expect(d.kind).toBe("draft");
    }
  });
  test("firm job after Proceed: no auto-send, no 'spot' or 'Ready Check' text", () => {
    for (const stage of ["ready_check_awaiting_acceptance", "ready_check_ready_to_schedule", "spot_saved"]) {
      for (const body of QUESTIONS) {
        const d = decideOwnerAutoReply(input(body, facts({ stage, spotSaved: true }), { isFirmQuote: true }));
        expect(d.kind).toBe("draft");
        if (d.kind === "send") { const m = renderOwnerAutoReplyEmail({ answer: d.answer, facts: d.facts, theirSubject: "Q" }); expect(m.text).not.toMatch(/spot|ready check/i); }
      }
    }
  });
  test("a thank-you still needs no reply, and a cancel still keeps its own path", () => {
    expect(decideOwnerAutoReply(input("Thanks, got it", facts(), { isFirmQuote: true })).kind).toBe("none");
    expect(decideOwnerAutoReply(input("Please cancel my job", facts(), { isFirmQuote: true })).kind).toBe("skip");
  });
  test("non-firm job unchanged", () => {
    for (const isFirmQuote of [false, undefined]) {
      const d = decideOwnerAutoReply(input("Hi, is my spot saved?", facts({ stage: "spot_saved", spotSaved: true }), isFirmQuote === undefined ? {} : { isFirmQuote }));
      expect(d).toMatchObject({ kind: "send", answer: "spot_saved" });
    }
    expect(decideOwnerAutoReply(input("How do I save my spot?", facts(), { isFirmQuote: false }))).toMatchObject({ kind: "send", answer: "save_spot" });
  });
});

// ---- server: a firm job leaves the Needs me row and sends nothing
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const db: Record<string, Row[]> = {};
const reset = () => {
  for (const k of Object.keys(db)) delete db[k];
  Object.assign(db, {
    jobs: [{ id: "job-firm", stage: "spot_saved", source: "base44", owner_id: "o1", deleted_at: null }],
    owners: [{ id: "o1", full_name: "Helen Yang", email: "helen@example.com" }],
    lead_campaign_responses: [{ job_id: "job-firm", spot_saved_at: "2026-10-20T00:00:00Z", opted_out_at: null }],
    customer_estimate_links: [{ job_id: "job-firm", purpose: "step3_estimate", status: "active", token: "tokreal", expires_at: "2099-01-01T00:00:00Z" }],
    businesses: [], partner_workers: [], partner_enquiries: [], profiles: [], bookings: [], quotes: [], workflow_events: [],
  });
};
function q(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const rows = () => (db[table] ?? []).filter((r) => filters.every((f) => f(r)));
  const api: any = { // eslint-disable-line @typescript-eslint/no-explicit-any
    select: () => api, order: () => api, limit: () => api,
    eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return api; },
    in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return api; },
    ilike: (k: string, v: string) => { filters.push((r) => String(r[k] ?? "").toLowerCase() === v.toLowerCase()); return api; },
    contains: (k: string, v: Row) => { filters.push((r) => Object.entries(v).every(([kk, vv]) => (r[k] ?? {})[kk] === vv)); return api; },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    insert: (row: Row) => { (db[table] ??= []).push({ ...row }); return Promise.resolve({ error: null }); },
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
  };
  return api;
}
const sent: string[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: q } }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true, assertCustomerDeliveryAllowed: async () => {} }));
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async () => { sent.push("test"); return { status: "sent", detail: "" }; } }));
mock.module("../src/lib/owner-email-send.server", () => ({ sendGuardedOwnerEmail: async () => { sent.push("owner"); return "sent"; } }));
mock.module("../src/lib/email-reply.server", () => ({ archiveRepliedMessage: async () => ({ status: "skipped", detail: "off" }) }));
const { autoReplyToOwner } = await import("../src/lib/owner-email-auto-reply.server");
const msg = (body: string) => ({ providerMessageId: "m1", threadId: "t1", internetMessageId: "<x@y>", direction: "inbound" as const, from: "helen@example.com", fromName: "Helen", to: ["info@homeinsulationvictoria.com.au"], cc: [], subject: "Spot", body, at: new Date().toISOString(), hasAttachments: false, attachments: [] as never[] });
const run = (isFirmQuote: (id: string) => Promise<boolean>, body = "Hi, is my spot saved?") => autoReplyToOwner({ jobIds: ["job-firm"], message: msg(body), mailbox: "info@homeinsulationvictoria.com.au", switches: { approved: true, archive: false }, deps: { isFirmQuote } });
const needsMe = () => db.workflow_events!.filter((e) => e["event_type"] === "email_change_request" && e["details"]?.intent === REPLY_NEEDED_INTENT);

describe("server", () => {
  test("firm job before Proceed: no auto-send, draft left", async () => {
    reset(); sent.length = 0;
    const r = await run(async () => true);
    expect(r).toMatchObject({ status: "draft", officeRow: true, suppressDraft: false });
    expect(sent).toEqual([]);
    expect(db.workflow_events!.filter((e) => e["event_type"] === EMAIL_AUTO_REPLIED_EVENT)).toHaveLength(0);
    expect(needsMe()).toHaveLength(1);
  });
  test("an unreadable firm-quote check leaves the draft too", async () => {
    reset(); sent.length = 0;
    const r = await run(async () => { throw new Error("db down"); });
    expect(r).toMatchObject({ status: "draft", officeRow: true });
    expect(sent).toEqual([]);
  });
  test("non-firm job unchanged: answered automatically", async () => {
    reset(); sent.length = 0;
    const r = await run(async () => false);
    expect(r).toMatchObject({ status: "sent", suppressDraft: true });
    expect(sent).toEqual(["owner"]);
  });
});
