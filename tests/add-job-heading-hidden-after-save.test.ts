import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Jo 31 Oct: once the job is added, the "Add a job" heading and its two intro lines go, so "Job added" sits at the top.
// "Add another job" brings them back.
const page = readFileSync("src/routes/_authenticated/partner.import.tsx", "utf8");
const flow = readFileSync("src/components/trade/add-job-flow.tsx", "utf8");

test("the page hides the heading block while a saved job is showing", () => {
  expect(page).toContain("{!added && (");
  expect(page).toContain("<div data-add-job-heading>");
  expect(page).toContain("onSavedChange={setAdded}");
});

test("the form tells the page when a job is saved and when 'Add another job' clears it", () => {
  expect(flow).toContain("onSavedChange?: (saved: boolean) => void");
  expect(flow).toContain("useEffect(() => { onSavedChange?.(saved !== null); }, [saved]);");
});
