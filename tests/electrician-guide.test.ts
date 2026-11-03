// Task 9 (29 Oct 2026) gave electricians a short guide. New job flow Part 6 Task 8 (Jo 2 Nov 2026): electricians never
// log in, so the electrician guide is gone with the rest of the electrician sign-in screens; Part 5 Task 11 retired the
// installer guide too (/field/guide redirects to My work).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("both guides are gone: the installer guide (Part 5 Task 11) and the electrician guide (Part 6 Task 8)", () => {
  const core = readFileSync("src/lib/trade-view.core.ts", "utf8");
  for (const name of ["GUIDE_STEPS", "GUIDE_WORDS", "ELECTRICIAN_GUIDE_STEPS", "ELECTRICIAN_GUIDE_WORDS", "guideTabTitle"]) expect(core).not.toContain(`export const ${name}`);
  expect(core).not.toContain("export function guideTabTitle");
  const page = readFileSync("src/routes/_authenticated/field.guide.tsx", "utf8");
  expect(page).toContain("redirect({ to: \"/field\"");
  expect(page).not.toContain("GUIDE_STEPS");
});
