// No-job follow-up replies (Jo 28 Oct 2026) go out through the info@ Outlook mailbox as a reply to their email, under a
// once-only claim taken BEFORE sending, so one double tap never sends two emails. In-memory tables; no network.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let n = 0;
let deleteAttempts = 0;
let failInsertTypes = new Set<string>();
const CLAIM = "email_nojob_followup_claim";
function from(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "delete" | "update" = "select", payload: Row = {}, one = false;
  const rows = () => (tables[table] ??= []);
  const get = (r: Row, c: string) => (c.includes("->>") ? r[c.split("->>")[0]!]?.[c.split("->>")[1]!] : r[c]);
  const run = () => {
    if (op === "insert") {
      if (failInsertTypes.has(payload["event_type"])) return { data: null, error: { message: "db down" } };
      // Like the migration's unique partial index on details->>'claim_key' for the claim type.
      if (table === "workflow_events" && payload["event_type"] === CLAIM && rows().some((r) => r["event_type"] === CLAIM && r["details"]?.["claim_key"] === payload["details"]?.["claim_key"])) return { data: null, error: { code: "23505", message: "duplicate key" } };
      const row = { id: `${table}${++n}`, created_at: "2026-10-29T00:00:00Z", ...payload };
      rows().push(row);
      return { data: { id: row.id }, error: null };
    }
    if (op === "update" || op === "delete") { deleteAttempts++; if (table === "workflow_events") throw new Error("workflow_events is append-only"); }
    const hit = rows().filter((r) => f.every((x) => x(r)));
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: Record<string, any> = {
    select: () => b, limit: () => b, order: () => b, maybeSingle: () => { one = true; return b; },
    insert: (p: Row) => { op = "insert"; payload = p; return b; },
    update: () => { op = "update"; return b; },
    delete: () => { op = "delete"; return b; },
    eq: (c: string, v: unknown) => { f.push((r) => get(r, c) === v); return b; },
    in: (c: string, v: unknown[]) => { f.push((r) => v.includes(get(r, c))); return b; },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve().then(run).then(res, rej),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));
let outlookSends: Row[] = [];
let outlookResult: Row = { outcome: "sent", messageId: "AAMk-1", internetMessageId: "<in-1@x>" };
mock.module("../src/lib/outlook-send.server", () => ({ sendViaOutlook: async (p: Row) => { outlookSends.push(p); await Promise.resolve(); return outlookResult; } }));
let archived: unknown[][] = [];
mock.module("../src/lib/outlook-sync.server", () => ({ archiveOutlookMessage: async (...a: unknown[]) => { archived.push(a); } }));
let commsOn = true;
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {}, customerCommsEnabled: async () => commsOn }));
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async () => { throw new Error("Resend must not be used"); } }));

// A fresh copy of the server module, so another test file's database mock (loaded first in the same run) is not reused.
const { sendNoJobEmailReply } = await import("../src/lib/emails-tab.server.ts?followup-outlook");
const { EMAIL_UNMATCHED_EVENT, EMAIL_UNMATCHED_DISMISSED_EVENT } = await import("../src/lib/outlook-guess.core");
const core = await import("../src/lib/emails-tab.core");
const { NO_JOB_DRAFT_EVENT, NO_JOB_REPLY_SENT_EVENT, noJobFollowUpSentKey } = core;
const NO_JOB_FOLLOWUP_CLAIM_EVENT = (core as Record<string, unknown>)["NO_JOB_FOLLOWUP_CLAIM_EVENT"];
const FAILED = "email_nojob_followup_failed";

const BODY = "Hi Sam,\n\nIt depends on installer availability in your area.";
const seed = () => {
  tables["workflow_events"] = [
    { id: "U1", job_id: null, event_type: EMAIL_UNMATCHED_EVENT, details: { from: "Sam@Example.com", message_id: "MSG9", subject: "Re: Price?" } },
    { id: "FD1", job_id: null, event_type: NO_JOB_DRAFT_EVENT, details: { unmatched_event_id: "U1", message_id: "MSG9", subject: "Re: Price?", kind: "follow_up" } },
  ];
};
const ev = (t: string) => tables["workflow_events"]!.filter((e) => e.event_type === t);
const send = () => sendNoJobEmailReply("U1", "FD1", BODY, "actor");
beforeEach(() => {
  tables = {}; n = 0; deleteAttempts = 0; failInsertTypes = new Set(); outlookSends = []; archived = []; commsOn = true;
  outlookResult = { outcome: "sent", messageId: "AAMk-1", internetMessageId: "<in-1@x>" };
  seed();
});
afterAll(() => mock.restore());

describe("follow-up reply through Outlook (sendNoJobEmailReply, kind follow_up)", () => {
  test("the claim event name is the one the migration allows", () => {
    expect(NO_JOB_FOLLOWUP_CLAIM_EVENT).toBe("email_nojob_followup_claim");
  });
  test("sends one Outlook reply to the original message, claims first, records it, dismisses and archives", async () => {
    expect(await send()).toEqual({ status: "sent" });
    expect(outlookSends).toHaveLength(1);
    expect(outlookSends[0]).toMatchObject({ replyToMessageId: "MSG9", to: "sam@example.com", subject: "Re: Price?" });
    expect(typeof outlookSends[0]!["html"]).toBe("string");
    const claims = ev(CLAIM);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.job_id).toBeNull();
    expect(claims[0]!.details["claim_key"]).toBe(`${noJobFollowUpSentKey("MSG9")}:try0`);
    const all = tables["workflow_events"]!;
    expect(all.indexOf(claims[0]!)).toBeLessThan(all.indexOf(ev(NO_JOB_REPLY_SENT_EVENT)[0]!));
    expect(ev(NO_JOB_REPLY_SENT_EVENT)[0]!.details).toMatchObject({ status: "sent", kind: "follow_up", sent_key: noJobFollowUpSentKey("MSG9"), draft_event_id: "FD1" });
    expect(ev(EMAIL_UNMATCHED_DISMISSED_EVENT)).toHaveLength(1);
    expect(archived).toEqual([["MSG9", null, "actor"]]);
  });
  test("two concurrent Sends (double tap) make one Outlook call; the other is refused with live's wording", async () => {
    const r = await Promise.allSettled([send(), send()]);
    expect(outlookSends).toHaveLength(1);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const no = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect((no.reason as Error).message).toBe("A reply to this email has already been sent.");
    expect(ev(NO_JOB_REPLY_SENT_EVENT)).toHaveLength(1);
  });
  test("definite failure records a job-less failure, throws live's message (one full stop), and a retry with the same words sends once", async () => {
    outlookResult = { outcome: "failed", detail: "Outlook isn't connected." };
    let msg = "";
    await send().catch((e: Error) => { msg = e.message; });
    expect(msg).toBe("Not sent — Outlook isn't connected. Reply to them from Outlook instead.");
    expect(ev(FAILED)).toHaveLength(1);
    expect(ev(FAILED)[0]!.job_id).toBeNull();
    expect(ev(FAILED)[0]!.details).toMatchObject({ message_id: "MSG9", unmatched_event_id: "U1", draft_event_id: "FD1", to: "sam@example.com", status: "failed: Outlook isn't connected." });
    expect(ev(NO_JOB_REPLY_SENT_EVENT)).toHaveLength(0);
    expect(archived).toHaveLength(0);
    outlookResult = { outcome: "sent", messageId: "AAMk-2", internetMessageId: null };
    expect(await send()).toEqual({ status: "sent" });
    expect(outlookSends).toHaveLength(2);
    expect(ev(CLAIM).map((c) => c.details["claim_key"])).toEqual([`${noJobFollowUpSentKey("MSG9")}:try0`, `${noJobFollowUpSentKey("MSG9")}:try1`]);
    expect(ev(NO_JOB_REPLY_SENT_EVENT).filter((e) => e.details["status"] === "sent")).toHaveLength(1);
    expect(deleteAttempts).toBe(0);
  });
  test("double tap on a retry after a definite failure still makes one Outlook call", async () => {
    outlookResult = { outcome: "failed", detail: "nope" };
    await expect(send()).rejects.toThrow("Not sent — nope. Reply to them from Outlook instead.");
    outlookResult = { outcome: "sent", messageId: "AAMk-2", internetMessageId: null };
    const r = await Promise.allSettled([send(), send()]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outlookSends).toHaveLength(2);
  });
  test("uncertain counts as sent (status recorded, archived) and a retry is refused with no Outlook call", async () => {
    outlookResult = { outcome: "uncertain", detail: "timed out", messageId: "" };
    expect(await send()).toEqual({ status: "delivery uncertain: timed out" });
    expect(ev(NO_JOB_REPLY_SENT_EVENT)[0]!.details["status"]).toBe("delivery uncertain: timed out");
    expect(archived).toHaveLength(1);
    expect(ev(FAILED)).toHaveLength(0);
    await expect(send()).rejects.toThrow();
    expect(outlookSends).toHaveLength(1);
  });
  test("uncertain whose records were lost: the claim alone still refuses the retry, no Outlook call", async () => {
    outlookResult = { outcome: "uncertain", detail: "timed out", messageId: "" };
    failInsertTypes = new Set([NO_JOB_REPLY_SENT_EVENT, EMAIL_UNMATCHED_DISMISSED_EVENT]);
    const spy = console.error; console.error = () => {};
    try { await send(); } finally { console.error = spy; }
    failInsertTypes = new Set();
    await expect(send()).rejects.toThrow("A reply to this email has already been sent.");
    expect(outlookSends).toHaveLength(1);
  });
  test("a send thrown as an error counts as uncertain (never resent)", async () => {
    mock.module("../src/lib/outlook-send.server", () => ({ sendViaOutlook: async (p: Row) => { outlookSends.push(p); throw new Error("socket hang up"); } }));
    try {
      expect(await send()).toEqual({ status: "delivery uncertain: socket hang up" });
      await expect(send()).rejects.toThrow();
      expect(outlookSends).toHaveLength(1);
    } finally {
      mock.module("../src/lib/outlook-send.server", () => ({ sendViaOutlook: async (p: Row) => { outlookSends.push(p); return outlookResult; } }));
    }
  });
  test("a refusal before sending (customer emails switched off) takes no claim, so Send works once switched on", async () => {
    commsOn = false;
    await expect(send()).rejects.toThrow("Customer emails are switched off — turn them on in Settings to send.");
    expect(ev(CLAIM)).toHaveLength(0);
    commsOn = true;
    expect(await send()).toEqual({ status: "sent" });
    expect(outlookSends).toHaveLength(1);
  });
  test("could not record the claim: nothing is sent", async () => {
    failInsertTypes = new Set([CLAIM]);
    await expect(send()).rejects.toThrow("Not sent");
    expect(outlookSends).toHaveLength(0);
  });
});
