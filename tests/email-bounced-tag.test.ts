import { expect, test } from "bun:test";
import { EMAIL_BOUNCE_CLEARED_EVENT, emailBouncedNow } from "../src/lib/email-delivery.core";

const b = (at: string) => ({ at, result: "bounced" as const });
const d = (at: string) => ({ at, result: "delivered" as const });

test("bounced then nothing: tag is on", () => {
  expect(emailBouncedNow([b("2026-10-01T00:00:00Z")], null)).toBe(true);
});
test("bounced then a later delivered email: tag is off", () => {
  expect(emailBouncedNow([b("2026-10-01T00:00:00Z"), d("2026-10-02T00:00:00Z")], null)).toBe(false);
});
test("bounced then cleared: tag is off", () => {
  expect(emailBouncedNow([b("2026-10-01T00:00:00Z")], "2026-10-02T00:00:00Z")).toBe(false);
});
test("bounced after an earlier clear: tag is on again", () => {
  expect(emailBouncedNow([b("2026-10-03T00:00:00Z")], "2026-10-02T00:00:00Z")).toBe(true);
});
test("no emails, or only delivered or unknown results: tag is off", () => {
  expect(emailBouncedNow([], null)).toBe(false);
  expect(emailBouncedNow([d("2026-10-01T00:00:00Z"), { at: "2026-10-02T00:00:00Z", result: null }], null)).toBe(false);
});
test("order of the list does not matter; a bounce after an older delivered is on", () => {
  expect(emailBouncedNow([b("2026-10-02T00:00:00Z"), d("2026-10-01T00:00:00Z")], null)).toBe(true);
});
test("event name", () => { expect(EMAIL_BOUNCE_CLEARED_EVENT).toBe("email_bounce_cleared"); });

import { bouncedJobIds } from "../src/lib/email-delivery.core";
test("bouncedJobIds works out each job on its own", () => {
  const ids = bouncedJobIds(
    [
      { jobId: "a", ...b("2026-10-01T00:00:00Z") },
      { jobId: "b", ...b("2026-10-01T00:00:00Z") },
      { jobId: "b", ...d("2026-10-02T00:00:00Z") },
      { jobId: "c", ...b("2026-10-01T00:00:00Z") },
      { jobId: "d", ...b("2026-10-05T00:00:00Z") },
    ],
    [{ jobId: "c", at: "2026-10-02T00:00:00Z" }, { jobId: "d", at: "2026-10-03T00:00:00Z" }, { jobId: "d", at: "2026-10-01T00:00:00Z" }],
  );
  expect([...ids].sort()).toEqual(["a", "d"]);
});

// Final review 6: only owner-facing emails count toward the tag — never trade/installer emails.
import { bounceTagEmails } from "../src/lib/email-delivery.core";
test("bounceTagEmails keeps owner-facing emails and drops trade/installer ones", () => {
  const rows = bounceTagEmails(
    [
      { job_id: "a", sent_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", delivery_at: null, delivery_result: "bounced", purpose: "owner_reply" },
      { job_id: "b", sent_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", delivery_at: null, delivery_result: "bounced", purpose: "job_cancelled_installer" },
    ],
    [
      { job_id: "c", sent_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", delivery_at: "2026-10-01T01:00:00Z", delivery_result: "bounced", visibility: "customer" },
      { job_id: "d", sent_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", delivery_at: null, delivery_result: "bounced", visibility: "trade" },
      { job_id: "e", sent_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", delivery_at: null, delivery_result: "bounced", visibility: "internal" },
    ],
  );
  expect(rows).toEqual([
    { jobId: "a", at: "2026-10-01T00:00:00Z", result: "bounced" },
    { jobId: "c", at: "2026-10-01T01:00:00Z", result: "bounced" },
  ]);
  expect([...bouncedJobIds(rows, [])].sort()).toEqual(["a", "c"]);
});
test("a trade bounce after a delivered owner email does not turn the tag on", () => {
  const rows = bounceTagEmails([], [
    { job_id: "a", sent_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", delivery_at: null, delivery_result: "delivered", visibility: "customer" },
    { job_id: "a", sent_at: "2026-10-02T00:00:00Z", created_at: "2026-10-02T00:00:00Z", delivery_at: null, delivery_result: "bounced", visibility: "trade" },
  ]);
  expect(bouncedJobIds(rows, []).has("a")).toBe(false);
});
