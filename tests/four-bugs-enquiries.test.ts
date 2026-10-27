import { expect, test } from "bun:test";
import { enquiryCategory, enquiryBulkCloseBlocker } from "../src/lib/enquiry-categories.core";
const now = Date.parse("2026-10-27T10:28:00Z");
const f = { createdAt: "2025-01-01", enquiryStatus: "offered_spot", lastOutboundAt: "2025-02-01", lastOwnerAt: null, inboundAt: null, optedOut: false, sendFailed: false, noResponseYet: false };
test("no confirmed first reply stays protected however old", () => {
  expect(enquiryCategory({ ...f, noResponseYet: true }, now)).toBe("not_sent");
  expect(enquiryBulkCloseBlocker({ ...f, noResponseYet: true }, now)).toContain("no confirmed first reply");
});
test("unanswered owner mail stays protected beyond 28 days and bulk recheck refuses", () => {
  const unanswered = { ...f, inboundAt: "2025-03-01", lastOwnerAt: "2025-03-01" };
  expect(enquiryCategory(unanswered, now)).toBe("offered");
  expect(enquiryBulkCloseBlocker(unanswered, now)).toContain("has not been answered");
  expect(enquiryBulkCloseBlocker({ ...unanswered, lastOutboundAt: "2025-04-01" }, now)).toBeNull();
});