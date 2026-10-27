import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CLOSABLE, ENQUIRY_CATEGORIES, ENQUIRY_VIEWS, categoryCounts, enquiryCategory, inView, ownerWrote } from "../src/lib/enquiry-categories.core";

const NOW = Date.parse("2026-10-26T00:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const base = { createdAt: ago(10), enquiryStatus: "offered_spot", lastOutboundAt: ago(3), lastOwnerAt: null, optedOut: false, sendFailed: false, noResponseYet: false };

test("opted out wins, then an email that didn't send", () => {
  expect(enquiryCategory({ ...base, optedOut: true, sendFailed: true }, NOW)).toBe("opted_out");
  expect(enquiryCategory({ ...base, sendFailed: true, createdAt: ago(90), lastOutboundAt: null }, NOW)).toBe("not_sent");
  expect(enquiryCategory({ ...base, noResponseYet: true, createdAt: ago(1), lastOutboundAt: null }, NOW)).toBe("not_sent");
  // Jo 27 Oct 2026: a lead that never got a first response is never "Gone quiet", whatever its age.
  expect(enquiryCategory({ ...base, noResponseYet: true, createdAt: ago(90), lastOutboundAt: null }, NOW)).toBe("not_sent");
});

test("never contacted is never Gone quiet, so Close all can't reach it (Jo 27 Oct 2026)", () => {
  const never = { ...base, noResponseYet: true, createdAt: ago(400), lastOutboundAt: null, lastOwnerAt: null };
  expect(enquiryCategory(never, NOW)).toBe("not_sent");
  // The owner wrote and we never answered: still an email to chase, not a quiet lead.
  expect(enquiryCategory({ ...never, lastOwnerAt: ago(120) }, NOW)).toBe("not_sent");
  // It sits in the opening view and is not one of the groups "Close all" can close.
  expect(inView("not_sent", "active")).toBe(true);
  expect(Object.keys(CLOSABLE)).toEqual(["quiet", "opted_out"]);
  // With a first response recorded, the same age is still Gone quiet.
  expect(enquiryCategory({ ...never, noResponseYet: false }, NOW)).toBe("quiet");
});

test("the screen's tabs and the office check share one list of names (Jo 27 Oct 2026)", () => {
  expect(ENQUIRY_VIEWS).toEqual(["active", "all", ...ENQUIRY_CATEGORIES.map((c) => c.key)]);
  const server = readFileSync("src/lib/office-screens.functions.ts", "utf8");
  expect(server).toContain('import { ENQUIRY_VIEWS } from "./enquiry-categories.core"');
  expect(server).toContain("view: z.enum(ENQUIRY_VIEWS)");
  expect(server).not.toMatch(/view: z\.enum\(\[/);
  const screen = readFileSync("src/components/portal/EnquiriesScreen.tsx", "utf8");
  expect(screen).toContain("ENQUIRY_CATEGORIES.map");
  expect(screen).not.toMatch(/value: "(offered|not_sent|opted_out|quiet)"/);
});

test("the journey: offered a spot; no questions step (Jo 26 Oct: we don't ask for answers)", () => {
  expect(enquiryCategory(base, NOW)).toBe("offered");
  // An older lead that once got the 3 questions email waits on Save my spot like everyone else.
  expect(enquiryCategory({ ...base, enquiryStatus: "insulation_requested" }, NOW)).toBe("offered");
  expect(readFileSync("src/lib/enquiry-categories.core.ts", "utf8")).not.toMatch(/details_asked|details_answered|Answered the questions/);
});

test("gone quiet: nothing either way for more than 4 weeks", () => {
  expect(enquiryCategory({ ...base, createdAt: ago(200), lastOutboundAt: ago(150) }, NOW)).toBe("quiet");
  expect(enquiryCategory({ ...base, createdAt: ago(200), lastOutboundAt: ago(10) }, NOW)).toBe("offered");
  expect(enquiryCategory({ ...base, createdAt: ago(200), lastOutboundAt: ago(60), lastOwnerAt: ago(5), enquiryStatus: "insulation_requested" }, NOW)).toBe("offered");
});

test("views and counts: the opening view leaves out opted out and gone quiet", () => {
  expect(inView("quiet", "active")).toBe(false);
  expect(inView("opted_out", "active")).toBe(false);
  expect(inView("offered", "active")).toBe(true);
  expect(inView("quiet", "all")).toBe(true);
  expect(inView("offered", "not_sent")).toBe(false);
  expect(categoryCounts(["offered", "quiet", "quiet", "opted_out", "not_sent"])).toEqual({ offered: 1, not_sent: 1, opted_out: 1, quiet: 2, active: 2, all: 5 });
});

test("emails live on the office Emails tab (decision 414), not on Enquiries", () => {
  const screen = readFileSync("src/components/portal/EnquiriesScreen.tsx", "utf8");
  expect(screen).not.toMatch(/EmailsToMatch|emails-to-match/);
});

test("Wrote to us: the owner emailed in the last 14 days and we haven't written since", () => {
  expect(ownerWrote({ inboundAt: ago(2), lastOutboundAt: ago(5) }, NOW)).toBe(ago(2));
  expect(ownerWrote({ inboundAt: ago(2), lastOutboundAt: null }, NOW)).toBe(ago(2));
  expect(ownerWrote({ inboundAt: ago(2), lastOutboundAt: ago(1) }, NOW)).toBeNull();
  expect(ownerWrote({ inboundAt: ago(20), lastOutboundAt: null }, NOW)).toBeNull();
  expect(ownerWrote({ inboundAt: null, lastOutboundAt: ago(1) }, NOW)).toBeNull();
});
