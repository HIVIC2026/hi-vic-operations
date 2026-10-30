import { expect, test } from "bun:test";
import { CLOSE_REASONS, closeRouteFor, enquiryCountLine } from "../src/lib/enquiries-screen.core";

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
