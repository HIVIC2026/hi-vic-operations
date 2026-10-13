// S20-R01: the pure new-enquiry gate for automatic decision emails (master switch off). Fails closed.
import { describe, expect, test } from "bun:test";
import * as C from "../src/lib/enquiry-auto-reply.core";

const NOW = Date.parse("2026-10-20T00:00:00Z");
const ok: C.AutoReplyFacts = { enabled: true, startsAt: "2026-10-14T00:00:00Z", jobCreatedAt: "2026-10-19T00:00:00Z", jobSource: "base44", jobDeleted: false, recipient: "jet.zhezhang@gmail.com", suppressed: false, now: NOW };
const b = (x: Partial<C.AutoReplyFacts>) => C.newEnquiryAutoReplyBlocker({ ...ok, ...x });

describe("newEnquiryAutoReplyBlocker", () => {
  test("a new, recent enquiry with a real address may be emailed", () => expect(b({})).toBeNull());
  test("switched off / unreadable switch → off", () => { expect(b({ enabled: false })).toBe(C.AUTO_REPLY_OFF); expect(b({ enabled: null })).toBe(C.AUTO_REPLY_OFF); });
  test("no or invalid start time → nothing", () => { expect(b({ startsAt: null })).toBe(C.AUTO_REPLY_NO_START); expect(b({ startsAt: "not a date" })).toBe(C.AUTO_REPLY_NO_START); });
  test("historical: received before the start time", () => expect(b({ jobCreatedAt: "2026-10-13T23:59:59Z" })).toBe(C.AUTO_REPLY_HISTORICAL));
  test("received exactly at the start time counts as new", () => expect(b({ jobCreatedAt: "2026-10-14T00:00:00Z" })).toBeNull());
  test("older than 14 days is never automatic, even if the start time was moved back", () => expect(b({ startsAt: "2026-01-01T00:00:00Z", jobCreatedAt: "2026-10-05T23:00:00Z" })).toBe(C.AUTO_REPLY_TOO_OLD));
  test("unreadable enquiry date → nothing", () => expect(b({ jobCreatedAt: null })).toBe(C.AUTO_REPLY_UNREADABLE));
  test("TEST enquiries never", () => expect(b({ jobSource: "qa_test" })).toBe(C.AUTO_REPLY_TEST_JOB));
  test("deleted enquiries never", () => expect(b({ jobDeleted: true })).toBe(C.AUTO_REPLY_DELETED));
  test("recipient validation", () => {
    for (const r of [null, "", "not-an-email", "owner@example.com", "x@test", "qa.owner@home.com.au", "a+qa@gmail.com"]) expect(b({ recipient: r })).toBe(C.AUTO_REPLY_BAD_RECIPIENT);
  });
  test("bounced / complained / unsubscribed", () => expect(b({ suppressed: true })).toBe(C.AUTO_REPLY_SUPPRESSED));
});
