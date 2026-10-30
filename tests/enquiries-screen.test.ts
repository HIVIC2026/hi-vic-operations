import { expect, test } from "bun:test";
import { CLOSE_REASONS, closeRouteFor } from "../src/lib/enquiries-screen.core";

test("Close reason picks where it's filed", () => {
  for (const r of ["Duplicate", " junk / spam ", "TEST"]) expect(closeRouteFor(r)).toBe("remove");
  for (const r of ["No response", "Owner opted out", "Duplicate address, owner moved"]) expect(closeRouteFor(r)).toBe("cancel");
  expect([...CLOSE_REASONS]).toEqual(["No response", "Owner changed mind", "Not eligible", "Owner opted out", "Duplicate", "Junk / spam", "Test"]);
});
