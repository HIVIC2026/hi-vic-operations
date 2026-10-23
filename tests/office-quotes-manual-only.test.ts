import { expect, test } from "bun:test";
import { automaticQuoteSendingAllowed, quoteNeedsOfficeReview, quoteReviewReasons } from "../src/lib/office-quote-review.core";
import { confirmedQuoteDecision } from "../src/lib/quote-release.core";
test.each(["A1", "A2"])("%s ready quotes never auto-send, even with every switch on", () => {
  expect(automaticQuoteSendingAllowed()).toBe(false);
  expect(confirmedQuoteDecision({ estimateTotal: 4000, quoteTotal: 4000, tolerancePct: 15, hasUnratedExtras: false, externalSendingEnabled: true }).status).toBe("draft");
});
test("waiting for office review isn't a missing-facts hold; real holds remain", () => {
  expect(quoteReviewReasons("Waiting for office review before sending · Missing product", null, "2026-10-23T00:00:00Z")).toEqual(["Missing product"]);
});
test("new hold reasons override a draft; older resolved history does not", () => {
  expect(quoteReviewReasons(null, { at: "2026-10-23T01:00:00Z", reasons: ["R2 or above"] }, "2026-10-23T00:00:00Z")).toEqual(["R2 or above"]);
  expect(quoteReviewReasons(null, { at: "2026-10-22T01:00:00Z", reasons: ["Missing product"] }, "2026-10-23T00:00:00Z")).toEqual([]);
});
test("old auto-queued unsent quotes still need office review, sent and accepted do not", () => {
  expect(quoteNeedsOfficeReview({ status: "issued", release_state: "queued", sent_at: null })).toBe(true);
  expect(quoteNeedsOfficeReview({ status: "issued", release_state: "released", sent_at: "2026-10-23" })).toBe(false);
  expect(quoteNeedsOfficeReview({ status: "accepted" })).toBe(false);
});