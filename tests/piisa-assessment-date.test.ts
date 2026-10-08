import { expect, test } from "bun:test";
import { piisaAssessmentDay } from "../src/lib/piisa-assessment-date.core";

test("expected completion uses captured PIISA day in Australia/Sydney with daylight saving", () => {
  expect(piisaAssessmentDay("2026-10-08T14:30:00Z")).toBe("2026-10-09");
  expect(piisaAssessmentDay("2026-07-08T13:30:00Z")).toBe("2026-07-08");
  expect(piisaAssessmentDay("2026-07-08T14:30:00Z")).toBe("2026-07-09");
});
test("no captured PIISA timestamp means no expected date, never installation or completion fallback", () => {
  expect(piisaAssessmentDay(null)).toBeNull();
  expect(piisaAssessmentDay("2026-10-08")).toBeNull();
  expect(piisaAssessmentDay("2026-10-08T14:30:00")).toBeNull();
  expect(piisaAssessmentDay("invalid")).toBeNull();
});