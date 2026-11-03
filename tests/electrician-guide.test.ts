// Task 9 (29 Oct 2026) gave electricians a short guide. New job flow Part 6 Task 8 (Jo 2 Nov 2026): electricians never
// log in, so the electrician guide is gone with the rest of the electrician sign-in screens; the installer guide stays.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { GUIDE_STEPS } from "../src/lib/trade-view.core";

test("installer guide steps are unchanged", () => {
  expect(GUIDE_STEPS.map((s) => s.title)).toEqual(["Get the job", "Ready Check", "PIESA", "Install days", "Install day"]);
});

test("guide page: the installer guide only (no electrician branch)", () => {
  const page = readFileSync("src/routes/_authenticated/field.guide.tsx", "utf8");
  expect(page).toContain("getTradeBusiness");
  expect(page).not.toContain('kind === "electrician"');
  expect(page).not.toContain("ELECTRICIAN_GUIDE_STEPS");
  expect(page).toContain("GUIDE_STEPS.map");
});

test("business page guide row sub differs for electricians only", () => {
  const page = readFileSync("src/routes/_authenticated/field.business.tsx", "utf8");
  expect(page).toContain('"One minute: every job and getting paid"');
});
