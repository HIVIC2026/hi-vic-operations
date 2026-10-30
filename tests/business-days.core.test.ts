import { expect, test } from "bun:test";
import { addVicBusinessDays } from "../src/lib/melbourne-time.core";

test("five Victorian business days after Friday 30 October skips Cup Day", () => {
  expect(addVicBusinessDays("2026-10-30", 5)).toBe("2026-11-09");
});
test("2027 Cup Day and Melbourne timestamps use the shared calendar", () => {
  expect(addVicBusinessDays("2027-11-01", 1)).toBe("2027-11-03");
  expect(addVicBusinessDays("2026-10-29T14:00:00Z", 5)).toBe("2026-11-09");
});