// Emails-tab Send buttons go out through the info@ Outlook mailbox (job replies via the guarded sender, no-job replies
// via sendViaOutlook). In-memory tables; no network.
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

type Row = Record<string, any>;
let tables: Record<string, Row[]> = {};
let n = 0;
let deleteAttempts = 0;
let failInsertOn: string | null = null;
let failUpdateOn: string | null = null;
function from(table: string) {
  const f: ((r: Row) => boolean)[] = [];
  let op: "select" | "insert" | "delete" | "update" = "select", payload: Row = {}, one = false;
  const rows = () => (tables[table] ??= []);
  const get = (r: Row, c: string) => (c.includes("->>") ? r[c.split("->>")[0]!]?.[c.split("->>")[1]!] : r[c]);
  const run = () => {
    if (op === "insert") {
      if (failInsertOn === table) return { data: null, error: { message: "db down" } };
      if (table === "workflow_events" && payload["idempotency_key"] === undefined && payload["details"]?.["idempotency_key"] && rows().some((r) => r["details"]?.["idempotency_key"] === payload["details"]["idempotency_key"] && r["event_type"] === payload["event_type"])) return { data: null, error: { code: "23505", message: "duplicate" } };
      const row = { id: `${table}${++n}`, created_at: "2026-10-28T00:00:00Z", ...payload };
      rows().push(row);
      return { data: { id: row.id }, error: null };
    }
    const hit = rows().filter((r) => f.every((x) => x(r)));
    if (op === "update") { if (failUpdateOn === table) return { data: null, error: { message: "db down" } }; for (const r of hit) Object.assign(r, payload); return { data: null, error: null }; }
    if (op === "delete") { deleteAttempts++; if (table === "workflow_events") throw new Error("workflow_events is append-only"); }
    if (op === "delete") { tables[table] = rows().filter((r) => !hit.includes(r)); return { data: null, error: null }; }
    return { data: one ? hit[0] ?? null : hit, error: null };
  };
  const b: Record<string, any> = {
    select: () => b, limit: () => b,
    insert: (p: Row) => { op = "insert"; payload = p; return b; },
    update: (p: Row) => { op = "update"; payload = p; return b; },
    single: () => { one = true; return b; },
    delete: () => { op = "delete"; return b; },
    eq: (c: string, v: unknown) => { f.push((r) => get(r, c) === v); return b; },
    in: (c: string, v: unknown[]) => { f.push((r) => v.includes(get(r, c))); return b; },
    contains: (c: string, v: Row) => { f.push((r) => Object.entries(v).every(([k, x]) => r[c]?.[k] === x)); return b; },
    maybeSingle: () => { one = true; return b; },
    then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
  };
  return b;
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from } }));

let guardCalls: Row[] = [];
let guardResult: { status: string; sent?: { provider: "outlook"; messageId: string | null; internetMessageId: string | null } } = { status: "sent" };
mock.module("../src/lib/owner-email-send.server", () => ({
  // Like the real guard: a successful attempt leaves one customer_email_sends row under the caller's key.
  sendGuardedOwnerEmail: async (p: Row) => { guardCalls.push(p); (tables["customer_email_sends"] ??= []).push({ id: `ces${++n}`, job_id: p["jobId"], purpose: p["purpose"], idempotency_key: p["key"], status: guardResult.status === "sent" ? "sent" : "failed", sent_at: "2026-10-28T00:00:01Z", created_at: "2026-10-28T00:00:00Z", error: null, communication_id: null, delivery_result: null, delivery_detail: null }); if (guardResult.sent) p["onSent"]?.(guardResult.sent); return guardResult.status; },
}));
let outlookSends: Row[] = [];
let outlookResult: Row = { outcome: "sent", messageId: "AAMk-sent-1", internetMessageId: "<in-1@x>" };
mock.module("../src/lib/outlook-send.server", () => ({ sendViaOutlook: async (p: Row) => { outlookSends.push(p); return outlookResult; } }));
let archived: unknown[][] = [];
mock.module("../src/lib/outlook-sync.server", () => ({ archiveOutlookMessage: async (...a: unknown[]) => { archived.push(a); } }));
let testSends = 0;
mock.module("../src/lib/test-send.server", () => ({ sendTestEmail: async () => { testSends++; return { status: "sent", detail: "" }; } }));
mock.module("../src/lib/comms.server", () => ({ assertCustomerDeliveryAllowed: async () => {}, customerCommsEnabled: async () => true }));
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async () => { throw new Error("Resend must not be used"); } }));

const { sendAiDraft } = await import("../src/lib/ai-email-reply.server");
const { sendNoJobEmailReply } = await import("../src/lib/emails-tab.server");
const { AI_EMAIL_DRAFT_EVENT, AI_EMAIL_DRAFT_SENT_EVENT } = await import("../src/lib/ai-email-reply.core");
const { EMAIL_UNMATCHED_EVENT } = await import("../src/lib/outlook-guess.core");
const { NO_JOB_DRAFT_EVENT, NO_JOB_REPLY_SENT_EVENT } = await import("../src/lib/emails-tab.core");
const { NEW_SENDER_REPLIED_EVENT, newSenderReplyKey } = await import("../src/lib/new-sender-reply.core");

const BODY = "Hi Sam,\n\nYes, your spot is saved. We will be in touch.\n\nCheers, the Home Insulation Victoria team";
const FAIL = "Not sent — Outlook couldn't send it. Try again.";
const seedJob = (source = "website") => {
  tables["jobs"] = [{ id: "J", source, owner_id: "O" }];
  tables["owners"] = [{ id: "O", email: "owner@example.com" }];
  tables["workflow_events"] = [{ id: "D1", job_id: "J", event_type: AI_EMAIL_DRAFT_EVENT, details: { message_id: "MSG1", to: "owner@example.com", subject: "Re: spot", body: BODY } }];
};
const seedNoJob = () => {
  tables["workflow_events"] = [
    { id: "U1", job_id: null, event_type: EMAIL_UNMATCHED_EVENT, details: { from: "Sam@Example.com", message_id: "MSG9", subject: "Price?" } },
    { id: "ND1", job_id: null, event_type: NO_JOB_DRAFT_EVENT, details: { unmatched_event_id: "U1", message_id: "MSG9", subject: "Re: Price?" } },
  ];
};
beforeEach(() => {
  tables = {}; n = 0; deleteAttempts = 0; failInsertOn = null; failUpdateOn = null; guardCalls = []; outlookSends = []; archived = []; testSends = 0;
  guardResult = { status: "sent", sent: { provider: "outlook", messageId: "AAMk-sent-1", internetMessageId: "<in-1@x>" } };
  outlookResult = { outcome: "sent", messageId: "AAMk-sent-1", internetMessageId: "<in-1@x>" };
});
afterAll(() => mock.restore());

describe("job reply (sendAiDraft)", () => {
  test("uses the guarded Outlook transport replying to the original message, with once-only retry allowed", async () => {
    seedJob();
    expect(await sendAiDraft("D1", BODY, "actor")).toEqual({ status: "sent" });
    expect(guardCalls).toHaveLength(1);
    expect(guardCalls[0]!["transport"]).toEqual({ kind: "outlook", replyToMessageId: "MSG1" });
    expect(guardCalls[0]!["retryAfterDefiniteFailure"]).toBe(true);
  });
  test("success writes one outlook history row with the Outlook ids, the sent event, and archives the original", async () => {
    seedJob();
    await sendAiDraft("D1", BODY, "actor");
    const hist = tables["job_communications"]!;
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ provider: "outlook", provider_message_id: "AAMk-sent-1", source_reference: "<in-1@x>", direction: "outbound", job_id: "J" });
    const sent = tables["workflow_events"]!.filter((e) => e.event_type === AI_EMAIL_DRAFT_SENT_EVENT);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.details["draft_event_id"]).toBe("D1");
    expect(archived).toEqual([["MSG1", "J", "actor"]]);
  });
  test("history source_reference falls back to the draft event id when Outlook gave no internet id", async () => {
    seedJob();
    guardResult = { status: "sent", sent: { provider: "outlook", messageId: "AAMk-2", internetMessageId: null } };
    await sendAiDraft("D1", BODY, "actor");
    expect(tables["job_communications"]![0]).toMatchObject({ provider_message_id: "AAMk-2", source_reference: "D1" });
  });
  test("definite Outlook failure throws the exact message and leaves the draft waiting (no event, no history, no archive)", async () => {
    seedJob();
    guardResult = { status: "failed: Outlook couldn't send it" };
    await expect(sendAiDraft("D1", BODY, "actor")).rejects.toThrow(FAIL);
    expect(tables["workflow_events"]!.filter((e) => e.event_type === AI_EMAIL_DRAFT_SENT_EVENT)).toHaveLength(0);
    expect(tables["job_communications"] ?? []).toHaveLength(0);
    expect(archived).toHaveLength(0);
  });
  test("an uncertain send counts as sent: event and history recorded (archived, not an error", async () => {
    seedJob();
    guardResult = { status: "delivery uncertain — not retried" };
    expect(await sendAiDraft("D1", BODY, "actor")).toEqual({ status: "delivery uncertain — not retried" });
    expect(tables["workflow_events"]!.filter((e) => e.event_type === AI_EMAIL_DRAFT_SENT_EVENT)).toHaveLength(1);
    expect(tables["job_communications"]![0]).toMatchObject({ provider: "outlook", provider_message_id: null, source_reference: "D1" });
    expect(archived).toHaveLength(1);
  });
  test("an uncertain send stores the Outlook message id on the history row", async () => {
    seedJob();
    guardResult = { status: "delivery uncertain — not retried", sent: { provider: "outlook", messageId: "AAMk-unc", internetMessageId: null } };
    await sendAiDraft("D1", BODY, "actor");
    expect(tables["job_communications"]![0]).toMatchObject({ provider: "outlook", provider_message_id: "AAMk-unc", source_reference: "D1" });
  });
  test("other refusals keep their old wording", async () => {
    seedJob();
    guardResult = { status: "skipped: owner opted out" };
    await expect(sendAiDraft("D1", BODY, "actor")).rejects.toThrow("Not sent — skipped: owner opted out");
  });
  test("recording failure after a successful send still returns sent", async () => {
    seedJob();
    failInsertOn = "job_communications";
    expect(await sendAiDraft("D1", BODY, "actor")).toEqual({ status: "sent" });
  });
  test("final review 3: one reply = one contact-history row (the send row is linked to its history row)", async () => {
    seedJob();
    await sendAiDraft("D1", BODY, "actor");
    const send = tables["customer_email_sends"]!;
    const hist = tables["job_communications"]!;
    expect(send).toHaveLength(1);
    expect(send[0]!["communication_id"]).toBe(hist[0]!["id"]);
    const { mergeContactHistory } = await import("../src/lib/contact-history.core");
    const rows = mergeContactHistory({ emails: send as any, comms: hist.map((c) => ({ received_at: null, delivery_result: null, delivery_detail: null, ...c })) as any, sms: [], messages: [], ownerActions: [] });
    expect(rows).toHaveLength(1);
  });
  test("final review 3: a failed link is logged and the reply is still sent", async () => {
    seedJob();
    failUpdateOn = "customer_email_sends";
    const logged: unknown[] = []; const spy = console.error; console.error = (...a: unknown[]) => { logged.push(a); };
    try { expect(await sendAiDraft("D1", BODY, "actor")).toEqual({ status: "sent" }); } finally { console.error = spy; }
    expect(logged.length).toBeGreaterThan(0);
    expect(archived).toHaveLength(1);
  });
  test("qa_test jobs go through the same guarded Outlook send, never the old test sender", async () => {
    seedJob("qa_test");
    await sendAiDraft("D1", BODY, "actor");
    expect(testSends).toBe(0);
    expect(guardCalls).toHaveLength(1);
    expect(guardCalls[0]!["jobSource"]).toBe("qa_test");
    expect(guardCalls[0]!["transport"]).toMatchObject({ kind: "outlook" });
  });
});

describe("no-job reply (sendNoJobEmailReply)", () => {
  const claims = () => tables["workflow_events"]!.filter((e) => e.event_type === NEW_SENDER_REPLIED_EVENT);
  test("sends through Outlook as a reply to the original message and records it as sent", async () => {
    seedNoJob();
    expect(await sendNoJobEmailReply("U1", "ND1", "Hi Sam,\n\nThanks for getting in touch! See https://homeinsulationvictoria.com.au/homeowner", "actor")).toEqual({ status: "sent" });
    expect(outlookSends).toHaveLength(1);
    expect(outlookSends[0]).toMatchObject({ replyToMessageId: "MSG9", to: "sam@example.com", subject: "Re: Price?" });
    expect(tables["workflow_events"]!.filter((e) => e.event_type === NO_JOB_REPLY_SENT_EVENT)[0]!.details["status"]).toBe("sent");
    expect(archived).toHaveLength(1);
  });
  const LINK = "Hi Sam,\n\nThanks for getting in touch! See https://homeinsulationvictoria.com.au/homeowner";
  const replies = () => tables["workflow_events"]!.filter((e) => e.event_type === NO_JOB_REPLY_SENT_EVENT);
  test("definite failure keeps the claim (append-only, no delete), records the failed link and throws live's message", async () => {
    seedNoJob();
    outlookResult = { outcome: "failed", detail: "nope" };
    await expect(sendNoJobEmailReply("U1", "ND1", LINK, "actor")).rejects.toThrow("Not sent — nope. Reply to them from Outlook instead.");
    expect(deleteAttempts).toBe(0);
    expect(claims()).toHaveLength(1);
    expect(replies()).toHaveLength(1);
    expect(replies()[0]!.details).toEqual({ failed_draft_event_id: "ND1", unmatched_event_id: "U1", to: "sam@example.com", status: "failed: nope", kind: "link" });
    expect(archived).toHaveLength(0);
  });
  test("after only failed earlier links, the next Send takes the :retry1 claim and goes through Outlook", async () => {
    seedNoJob();
    outlookResult = { outcome: "failed", detail: "nope" };
    await expect(sendNoJobEmailReply("U1", "ND1", LINK, "actor")).rejects.toThrow("Reply to them from Outlook instead.");
    outlookResult = { outcome: "sent", messageId: "AAMk-2", internetMessageId: null };
    expect(await sendNoJobEmailReply("U1", "ND1", LINK, "actor")).toEqual({ status: "sent" });
    expect(outlookSends).toHaveLength(2);
    expect(outlookSends[1]).toMatchObject({ replyToMessageId: "MSG9", to: "sam@example.com" });
    expect(claims().map((c) => c.details["idempotency_key"])).toEqual([newSenderReplyKey("sam@example.com"), `${newSenderReplyKey("sam@example.com")}:retry1`]);
    expect(replies().filter((r) => r.details["status"] === "sent")).toHaveLength(1);
  });
  // A second email from the same person (the first one has left the tab once answered).
  const seedSecondEmail = () => tables["workflow_events"]!.push(
    { id: "U2", job_id: null, event_type: EMAIL_UNMATCHED_EVENT, details: { from: "sam@example.com", message_id: "MSG10", subject: "Also" } },
    { id: "ND2", job_id: null, event_type: NO_JOB_DRAFT_EVENT, details: { unmatched_event_id: "U2", message_id: "MSG10", subject: "Re: Also" } });
  test("after a sent link, a second Send is refused with live's wording and nothing goes", async () => {
    seedNoJob();
    await sendNoJobEmailReply("U1", "ND1", LINK, "actor");
    seedSecondEmail();
    await expect(sendNoJobEmailReply("U2", "ND2", LINK, "actor")).rejects.toThrow("This person has already had a reply with the website link.");
    expect(outlookSends).toHaveLength(1);
  });
  test("after an uncertain link, a second Send is refused (uncertain counts as sent) and nothing goes", async () => {
    seedNoJob();
    outlookResult = { outcome: "uncertain", detail: "timed out", messageId: "AAMk-u" };
    await sendNoJobEmailReply("U1", "ND1", LINK, "actor");
    seedSecondEmail();
    await expect(sendNoJobEmailReply("U2", "ND2", LINK, "actor")).rejects.toThrow("This person has already had a reply with the website link.");
    expect(outlookSends).toHaveLength(1);
  });
  test("double tap sends one Outlook email", async () => {
    seedNoJob();
    const r = await Promise.allSettled([sendNoJobEmailReply("U1", "ND1", LINK, "actor"), sendNoJobEmailReply("U1", "ND1", LINK, "actor")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outlookSends).toHaveLength(1);
  });
  test("double tap on a retry after a failure sends one Outlook email", async () => {
    seedNoJob();
    outlookResult = { outcome: "failed", detail: "nope" };
    await expect(sendNoJobEmailReply("U1", "ND1", LINK, "actor")).rejects.toThrow();
    outlookResult = { outcome: "sent", messageId: "AAMk-2", internetMessageId: null };
    const r = await Promise.allSettled([sendNoJobEmailReply("U1", "ND1", LINK, "actor"), sendNoJobEmailReply("U1", "ND1", LINK, "actor")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(outlookSends).toHaveLength(2);
  });
  test("uncertain keeps the claim and counts as sent with the uncertain status", async () => {
    seedNoJob();
    outlookResult = { outcome: "uncertain", detail: "timed out", messageId: "AAMk-u" };
    const r = await sendNoJobEmailReply("U1", "ND1", "Hi Sam,\n\nThanks for getting in touch! See https://homeinsulationvictoria.com.au/homeowner", "actor");
    expect(r.status).toBe("delivery uncertain: timed out");
    expect(claims()).toHaveLength(1);
    expect(archived).toHaveLength(1);
  });
});
