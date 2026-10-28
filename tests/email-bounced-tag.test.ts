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
