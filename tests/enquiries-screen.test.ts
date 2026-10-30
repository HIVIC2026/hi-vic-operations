import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CLOSE_REASONS, closeRouteFor, enquiryCountLine, keepTicked, removeOutcomeToast, removeReasonText } from "../src/lib/enquiries-screen.core";

test("Close reason picks where it's filed", () => {
  for (const r of ["Duplicate", " junk / spam ", "TEST"]) expect(closeRouteFor(r)).toBe("remove");
  for (const r of ["No response", "Owner opted out", "Duplicate address, owner moved"]) expect(closeRouteFor(r)).toBe("cancel");
  expect([...CLOSE_REASONS]).toEqual(["No response", "Owner changed mind", "Not eligible", "Owner opted out", "Duplicate", "Junk / spam", "Test"]);
});

test("count line", () => {
  expect(enquiryCountLine(48, "5 min ago")).toBe("48 enquiries · updated 5 min ago");
  expect(enquiryCountLine(1, "just now")).toBe("1 enquiry · updated just now");
  expect(enquiryCountLine(1200, null)).toBe("1,200 enquiries");
});

test("remove outcome: all removed, or some left because only website enquiries can be removed", () => {
  expect(removeOutcomeToast(3, 3)).toEqual({ ok: true, text: "3 removed" });
  expect(removeOutcomeToast(1, 1)).toEqual({ ok: true, text: "1 removed" });
  expect(removeOutcomeToast(3, 1)).toEqual({ ok: false, text: "1 closed; 2 not: only website enquiries can go to Removed / test — close them with another reason" });
  expect(removeOutcomeToast(2, 0)).toEqual({ ok: false, text: "0 closed; 2 not: only website enquiries can go to Removed / test — close them with another reason" });
});

test("remove sends the preset text, not what was typed", () => {
  expect(removeReasonText(" junk  /  SPAM ")).toBe("Junk / spam");
  expect(removeReasonText("duplicate")).toBe("Duplicate");
  expect(removeReasonText("TEST")).toBe("Test");
  expect(closeRouteFor(" junk  /  SPAM ")).toBe("remove");
  expect(removeReasonText("Owner changed mind")).toBe("Owner changed mind");
});

test("after a partial remove the not-done enquiries stay ticked", () => {
  // a, b were on the page; a was removed (gone from the refreshed page); c was ticked on another page.
  expect([...keepTicked(["a", "b", "c"], ["a", "b", "x"], ["b", "x"])]).toEqual(["b", "c"]);
});

test("the Close dialog checks how many were removed and sends the preset", () => {
  const screen = readFileSync("src/components/portal/EnquiriesScreen.tsx", "utf8");
  expect(screen).toMatch(/removeOutcomeToast\(ids\.length, r\.removed\)/);
  expect(screen).toMatch(/reason: removeReasonText\(reason\)/);
  expect(screen).not.toMatch(/remove\(\{ ids, reason \}, "Removed"\)/);
});
