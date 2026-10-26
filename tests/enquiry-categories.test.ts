import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { categoryCounts, enquiryCategory, inView } from "../src/lib/enquiry-categories.core";

const NOW = Date.parse("2026-10-26T00:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const base = { createdAt: ago(10), enquiryStatus: "offered_spot", lastOutboundAt: ago(3), lastOwnerAt: null, answeredQuestions: false, optedOut: false, sendFailed: false, noResponseYet: false };

test("opted out wins, then an email that didn't send", () => {
  expect(enquiryCategory({ ...base, optedOut: true, sendFailed: true }, NOW)).toBe("opted_out");
  expect(enquiryCategory({ ...base, sendFailed: true, createdAt: ago(90), lastOutboundAt: null }, NOW)).toBe("not_sent");
  expect(enquiryCategory({ ...base, noResponseYet: true, createdAt: ago(1), lastOutboundAt: null }, NOW)).toBe("not_sent");
  // An old lead that never got a response has gone quiet, not a send to chase.
  expect(enquiryCategory({ ...base, noResponseYet: true, createdAt: ago(90), lastOutboundAt: null }, NOW)).toBe("quiet");
});

test("the journey: offered a spot, asked for insulation details, answered", () => {
  expect(enquiryCategory(base, NOW)).toBe("offered");
  expect(enquiryCategory({ ...base, enquiryStatus: "insulation_requested" }, NOW)).toBe("details_asked");
  expect(enquiryCategory({ ...base, enquiryStatus: "insulation_requested", answeredQuestions: true, lastOwnerAt: ago(1) }, NOW)).toBe("details_answered");
});

test("gone quiet: nothing either way for more than 4 weeks", () => {
  expect(enquiryCategory({ ...base, createdAt: ago(200), lastOutboundAt: ago(150) }, NOW)).toBe("quiet");
  expect(enquiryCategory({ ...base, createdAt: ago(200), lastOutboundAt: ago(10) }, NOW)).toBe("offered");
  expect(enquiryCategory({ ...base, createdAt: ago(200), lastOutboundAt: ago(60), lastOwnerAt: ago(5), enquiryStatus: "insulation_requested", answeredQuestions: true }, NOW)).toBe("details_answered");
});

test("views and counts: the opening view leaves out opted out and gone quiet", () => {
  expect(inView("quiet", "active")).toBe(false);
  expect(inView("opted_out", "active")).toBe(false);
  expect(inView("offered", "active")).toBe(true);
  expect(inView("quiet", "all")).toBe(true);
  expect(inView("offered", "details_asked")).toBe(false);
  expect(categoryCounts(["offered", "quiet", "quiet", "opted_out", "not_sent"])).toEqual({ offered: 1, details_asked: 0, details_answered: 0, not_sent: 1, opted_out: 1, quiet: 2, active: 2, all: 5 });
});

test("Jo 26 Oct: emails live in the Inbox, not on Enquiries", () => {
  const screen = readFileSync("src/components/portal/EnquiriesScreen.tsx", "utf8");
  expect(screen).not.toMatch(/EmailsToMatch|emails-to-match/);
  expect(readFileSync("src/routes/_authenticated/admin.inbox.tsx", "utf8")).toMatch(/InboxScreen/);
  expect(readFileSync("src/components/portal/office.tsx", "utf8")).toMatch(/InboxButton/);
});
