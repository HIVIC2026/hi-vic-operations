import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// Jo 31 Oct: electrician welcome email pay line reads "Get paid 7 days after we approve your completed PIESA."
const src = readFileSync("src/lib/partner-email.core.ts", "utf8");
test("electrician welcome email uses the new pay wording (benefits and steps)", () => {
  expect(src.match(/Get paid 7 days after we approve your completed PIESA\./g)?.length).toBe(2);
  expect(src).not.toContain("Get paid your agreed rate 7 days after we approve your completed form.");
});
