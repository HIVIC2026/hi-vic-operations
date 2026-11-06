import { expect, test } from "bun:test";
import { FIRM_QUOTE_REQUESTED_EVENT, FIRM_QUOTE_DAY4_EVENT, isFirmQuoteJob, firmQuoteDueBy, firmQuoteDay4Due, formatDueDate } from "../src/lib/firm-quote.core";

const website = { source: "base44", createdAt: "2026-11-06T06:00:00Z", liveAt: "2026-11-06T06:00:00Z", hasMedia: true };
test("request and day-four event names", () => {
  expect(FIRM_QUOTE_REQUESTED_EVENT).toBe("firm_quote_requested");
  expect(FIRM_QUOTE_DAY4_EVENT).toBe("firm_quote_day4_sent");
});
test("null go-live keeps the existing flow", () => expect(isFirmQuoteJob({ ...website, liveAt: null })).toBe(false));
test("pre-live website enquiries keep the existing flow", () => expect(isFirmQuoteJob({ ...website, createdAt: "2026-11-06T05:59:59Z" })).toBe(false));
test("media is required", () => expect(isFirmQuoteJob({ ...website, hasMedia: false })).toBe(false));
test("installer-added enquiries are excluded", () => expect(isFirmQuoteJob({ ...website, source: "installer_portal" })).toBe(false));
test("unknown sources are excluded", () => {
  expect(isFirmQuoteJob({ ...website, source: null })).toBe(false);
  expect(isFirmQuoteJob({ ...website, source: "unknown" })).toBe(false);
});
test("qa_test enquiries at go-live with media qualify", () => expect(isFirmQuoteJob({ ...website, source: "qa_test" })).toBe(true));
test("qa_test enquiries after go-live with media qualify", () => expect(isFirmQuoteJob({ ...website, source: "qa_test", createdAt: "2026-11-07T06:00:00Z" })).toBe(true));
test("qa_test enquiries stay legacy with the switch off", () => expect(isFirmQuoteJob({ ...website, source: "qa_test", liveAt: null })).toBe(false));
test("qa_test enquiries before go-live stay legacy", () => expect(isFirmQuoteJob({ ...website, source: "qa_test", createdAt: "2026-11-06T05:59:59Z" })).toBe(false));
test("qa_test enquiries without media stay legacy", () => expect(isFirmQuoteJob({ ...website, source: "qa_test", hasMedia: false })).toBe(false));
test("website enquiries at or after go-live with media qualify", () => {
  expect(isFirmQuoteJob(website)).toBe(true);
  expect(isFirmQuoteJob({ ...website, createdAt: "2026-11-07T06:00:00Z" })).toBe(true);
});
test("compare instants rather than timestamp spelling", () => expect(isFirmQuoteJob({ ...website, createdAt: "2026-11-06T17:00:00+11:00" })).toBe(true));
test("invalid timestamps fail closed", () => {
  expect(isFirmQuoteJob({ ...website, createdAt: "invalid" })).toBe(false);
  expect(isFirmQuoteJob({ ...website, liveAt: "invalid" })).toBe(false);
});
test("seven Victorian business days from Jo's Friday example", () => expect(firmQuoteDueBy("2026-11-06T06:00:00Z")).toBe("2026-11-17"));
test("business-day due date skips Cup Day", () => expect(firmQuoteDueBy("2026-10-30T06:00:00Z")).toBe("2026-11-11"));
test("request day is Melbourne's day, not UTC's day", () => expect(firmQuoteDueBy("2026-11-05T14:00:00Z")).toBe("2026-11-17"));
const reminder = { requestedAt: "2026-11-06T06:00:00Z", now: new Date("2026-11-10T06:00:00Z"), quoteSentAt: null, closed: false, day4SentAt: null };
test("day four is due at four calendar days", () => expect(firmQuoteDay4Due(reminder)).toBe(true));
test("day three is not due", () => expect(firmQuoteDay4Due({ ...reminder, now: new Date("2026-11-08T12:59:59Z") })).toBe(false));
test("Melbourne day four starts at midnight", () => expect(firmQuoteDay4Due({ ...reminder, now: new Date("2026-11-09T13:00:00Z") })).toBe(true));
test("late unsent reminders remain due", () => expect(firmQuoteDay4Due({ ...reminder, now: new Date("2026-11-12T06:00:00Z") })).toBe(true));
test("sent firm quote suppresses day four", () => expect(firmQuoteDay4Due({ ...reminder, quoteSentAt: "2026-11-09T06:00:00Z" })).toBe(false));
test("closed job suppresses day four", () => expect(firmQuoteDay4Due({ ...reminder, closed: true })).toBe(false));
test("already sent day four suppresses repeats", () => expect(firmQuoteDay4Due({ ...reminder, day4SentAt: "2026-11-10T05:00:00Z" })).toBe(false));
test("four calendar days across Melbourne daylight saving", () => expect(firmQuoteDay4Due({ ...reminder, requestedAt: "2026-10-01T13:30:00Z", now: new Date("2026-10-05T13:00:00Z") })).toBe(true));
test("invalid reminder timestamps fail closed", () => {
  expect(firmQuoteDay4Due({ ...reminder, requestedAt: "invalid" })).toBe(false);
  expect(firmQuoteDay4Due({ ...reminder, now: new Date("invalid") })).toBe(false);
});
test("due date uses Jo's weekday day month format", () => expect(formatDueDate("2026-11-20")).toBe("Friday 20 November"));