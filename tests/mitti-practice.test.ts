import { expect, test } from "bun:test";
import { practiceAllowed, practiceAnswers } from "../src/lib/mitti-practice.core";
const valid = { source: "qa_test", email: "installer@hivic-test.example", assigned: true, audit: "sim_a", linkedAudit: "sim_a", archived: null };
test("only assigned TEST installer on active TEST job can complete its bound simulated form", () => {
  expect(practiceAllowed(valid)).toBe(true);
  for (const patch of [{ source: "website" }, { email: "real@example.com" }, { assigned: false }, { linkedAudit: "sim_other" }, { audit: "real_audit" }, { archived: "yesterday" }]) expect(practiceAllowed({ ...valid, ...patch })).toBe(false);
});
test("per-area measurement remains grouped", () => {
  const items = practiceAnswers({ "Enter the measured ceiling area (m²)": "120" });
  expect(items.find(x => x.item_id === "practice_area")?.children?.[0]?.responses.text).toBe("120");
});