import { expect, test } from "bun:test";
import { answeredInOutlook, buildEmailsTab, type JobEmailRow } from "../src/lib/emails-tab.core";

const row = { threadId: "thread", at: "2026-10-27T22:00:00Z", from: "owner@example.test" };
const reply = { threadId: "thread", at: "2026-10-27T23:00:00Z", recipients: ["OWNER@example.test"] };
test("a sent Outlook reply answers the earlier email to that recipient", () => {
  expect(answeredInOutlook(row, [reply])).toBe(true);
});
test("a later inbound email remains unanswered", () => {
  expect(answeredInOutlook({ ...row, at: "2026-10-28T00:00:00Z" }, [reply])).toBe(false);
});
test("different thread or recipient does not resolve the email", () => {
  expect(answeredInOutlook({ ...row, threadId: "other" }, [reply])).toBe(false);
  expect(answeredInOutlook({ ...row, from: "other@example.test" }, [reply])).toBe(false);
});
test("missing identity or invalid sent timestamp is not proof of a reply", () => {
  expect(answeredInOutlook({ ...row, threadId: null }, [reply])).toBe(false);
  expect(answeredInOutlook(row, [{ ...reply, at: "invalid" }])).toBe(false);
});
test("reply-only card clears but outstanding cancellation and files work remain", () => {
  const change: JobEmailRow = { ...row, eventId: "reply", jobId: "job", jobNumber: "HV-TEST", intent: "reply", messageId: "message", subject: "Question", label: null };
  const tab = buildEmailsTab({ changes: [change, { ...change, eventId: "cancel", intent: "cancel" }, { ...change, eventId: "files", intent: "attachment" }], unmatched: [], jobDrafts: new Map(), noJobDrafts: new Map(), closedJobDrafts: new Set(), inboundByMessage: new Map(), ownerNameByJob: new Map(), autoRepliedSenders: new Set(), outlookReplies: [reply] });
  expect(tab.withJob.map((c) => c.requestEventId)).toEqual(["cancel", "files"]);
  expect(tab.count).toBe(2);
});
test("a clear decline on an open job still needs office action after a reply", () => {
  const change: JobEmailRow = { ...row, eventId: "decline", jobId: "job", jobNumber: "HV-TEST", intent: "reply", messageId: "message", subject: "No thanks", label: null };
  const tab = buildEmailsTab({ changes: [change], unmatched: [], jobDrafts: new Map(), noJobDrafts: new Map(), closedJobDrafts: new Set(), inboundByMessage: new Map([["message", "No thanks, I am not going ahead."]]), ownerNameByJob: new Map(), autoRepliedSenders: new Set(), outlookReplies: [reply], openJobIds: new Set(["job"]) });
  expect(tab.withJob).toHaveLength(1);
  expect(tab.withJob[0]?.stillOpenDecline).toBe(true);
});