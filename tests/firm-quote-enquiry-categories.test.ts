import { expect, test } from "bun:test";
import { categoryCounts, enquiryCategory, inView } from "../src/lib/enquiry-categories.core";
import { isFirmQuoteJob } from "../src/lib/firm-quote.core";

const now = Date.parse("2026-11-06T08:47:00Z");
const base = { createdAt: "2026-11-06T08:00:00Z", enquiryStatus: "offered_spot", lastOutboundAt: null, lastOwnerAt: null, optedOut: false, sendFailed: false, noResponseYet: true };
const firm = isFirmQuoteJob({ createdAt: base.createdAt, liveAt: "2026-11-06T00:00:00Z", source: "base44", hasMedia: true });

test("firm jobs belong only to With photos even before first response or after Proceed", () => {
  for (const enquiryStatus of ["offered_spot", "spot_saved"]) {
    const category = enquiryCategory({ ...base, enquiryStatus, firmQuote: firm }, now);
    expect(category).toBe("with_photos");
    expect(inView(category, "offered")).toBe(false);
    expect(inView(category, "not_sent")).toBe(false);
  }
});
test("opted-out and closed firm jobs keep their usual category", () => {
  expect(enquiryCategory({ ...base, firmQuote: firm, optedOut: true }, now)).toBe("opted_out");
  expect(enquiryCategory({ ...base, firmQuote: firm, closed: true }, now)).toBe(enquiryCategory(base, now));
});
test("pre-live photo jobs and null activation keep today's category", () => {
  for (const liveAt of [null, "2026-11-07T00:00:00Z"]) {
    expect(enquiryCategory({ ...base, firmQuote: isFirmQuoteJob({ createdAt: base.createdAt, liveAt, source: "base44", hasMedia: true }) }, now)).toBe("not_sent");
  }
});
test("each job contributes to exactly one tab count", () => {
  const categories = [enquiryCategory({ ...base, firmQuote: firm }, now), enquiryCategory(base, now), enquiryCategory({ ...base, optedOut: true, firmQuote: firm }, now)];
  const counts = categoryCounts(categories);
  expect(counts.with_photos).toBe(1);
  expect(counts.not_sent).toBe(1);
  expect(counts.opted_out).toBe(1);
  expect(counts.all).toBe(3);
  expect(counts.active).toBe(2);
  expect(counts.with_photos + counts.offered + counts.not_sent + counts.opted_out + counts.quiet).toBe(counts.all);
});