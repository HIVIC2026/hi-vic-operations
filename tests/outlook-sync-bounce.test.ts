import { test } from "bun:test";
import assert from "node:assert/strict";
import { outlookHarness, graphMessage, jsonResponse, TEST_JOB, TEST_MAILBOX } from "./helpers/outlook-recovery-harness.ts";

type Harness = Awaited<ReturnType<typeof outlookHarness>>;
const WINDOW = { inboxCompleteThrough: "2026-10-20T10:00:00Z" };
const SENT_ID = "sent-immutable-1";
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const practice = (fn: (h: Harness) => Promise<void>) => async () => {
  const h = await outlookHarness();
  try {
    await h.db.query(`UPDATE outlook_sync_state SET expected_mailbox=$1`, [TEST_MAILBOX]);
    h.control.fetch = async () => jsonResponse({ value: [] });
    await fn(h);
  } finally { await h.db.close(); }
};
// Our emails-tab reply, stored when it was sent (Task 5 shape).
const storeSentReply = (h: Harness, sentAt: string) => h.db.query(
  `INSERT INTO job_communications(job_id,direction,channel,recipients,subject,body,provider,provider_message_id,sent_at,delivery_status,visibility,source_event)
   VALUES($1,'outbound','email','["owner@example.test"]','HV-1001','We will see you Tuesday.','outlook',$2,$3,'sent','customer','email_ai_draft_sent')`, [TEST_JOB, SENT_ID, sentAt]);
const notice = (id: string, extras: Record<string, unknown> = {}) => graphMessage(id,
  "Delivery has failed to these recipients:\nowner@example.test\nThe address couldn't be found: user unknown.",
  { subject: "Undeliverable: HV-1001", from: { emailAddress: { address: "postmaster@example.test" } }, receivedDateTime: daysAgo(0), ...extras });
// Stand-in for applyDeliveryResult with the same never-overwrite-a-bounce rule, on the one table this fixture has.
const recordCalls = (h: Harness) => {
  const calls: any[] = [];
  h.control.deliveryStub = { applyDeliveryResult: async (p) => { calls.push(p); return 1; } };
  return calls;
};
const archiveRequests = (h: Harness) => h.requests.filter((r) => r.url.includes("/move"));

test("a bounce notice marks the reply it belongs to as bounced and archives the notice", practice(async (h) => {
  await h.db.query(`UPDATE outlook_sync_state SET expected_mailbox=$1`, [TEST_MAILBOX]);
  await storeSentReply(h, daysAgo(1));
  const calls = recordCalls(h);
  await h.server.processMessages([notice("notice-1")], TEST_MAILBOX, h.counts(), WINDOW);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].providerMessageId, SENT_ID);
  assert.equal(calls[0].result, "bounced");
  assert.equal(calls[0].detail, "Email address doesn't exist");
  assert.equal(archiveRequests(h).length, 1);
  assert.ok(decodeURIComponent(archiveRequests(h)[0]!.url).includes("notice-1/move"));
  assert.equal(Number((await h.db.query(`SELECT count(*)::int n FROM job_communications`)).rows[0]!.n), 1);
}));

test("a notice that matches no sent reply is left alone", practice(async (h) => {
  await storeSentReply(h, daysAgo(10)); // too old to be the one
  const calls = recordCalls(h);
  await h.server.processMessages([notice("notice-2")], TEST_MAILBOX, h.counts(), WINDOW);
  assert.equal(calls.length, 0);
  assert.equal(archiveRequests(h).length, 0);
}));

test("a failure while handling a notice never stops the other messages", practice(async (h) => {
  await storeSentReply(h, daysAgo(1));
  h.control.deliveryStub = { applyDeliveryResult: async () => { throw new Error("boom"); } };
  const counts = h.counts();
  await h.server.processMessages([notice("notice-3"), graphMessage("owner-hello", "Thanks, see you then.", { receivedDateTime: daysAgo(0) })], TEST_MAILBOX, counts, WINDOW);
  assert.equal(counts.stored, 1);
  assert.equal(archiveRequests(h).length, 0);
}));

test("our own reply read back from Sent Items adds no second row", practice(async (h) => {
  await storeSentReply(h, daysAgo(1));
  recordCalls(h);
  const sentCopy = graphMessage(SENT_ID, "We will see you Tuesday.", {
    from: { emailAddress: { address: TEST_MAILBOX } }, toRecipients: [{ emailAddress: { address: "owner@example.test" } }],
    sentDateTime: daysAgo(1), receivedDateTime: daysAgo(1),
  });
  const counts = h.counts();
  await h.server.processMessages([sentCopy], TEST_MAILBOX, counts, WINDOW);
  assert.equal(Number((await h.db.query(`SELECT count(*)::int n FROM job_communications`)).rows[0]!.n), 1);
  assert.equal(counts.stored, 0);
}));
