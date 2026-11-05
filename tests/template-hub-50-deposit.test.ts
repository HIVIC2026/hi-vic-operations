// Jo 5 Nov 2026 (50% deposit): Settings › Templates samples show amounts worked out by paymentPlan, not old 10%-sized cents.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("template hub samples carry no 10%-sized deposit/balance amounts", () => {
  const s = readFileSync(new URL("../src/lib/template-hub.core.ts", import.meta.url), "utf8");
  for (const old of ["18510", "15700", "141200", "166590", "185.1", "1665.9", "$185.10", "$1,412.00"]) expect(s).not.toContain(old);
  expect(s).toContain("SAMPLE_PLAN = paymentPlan({ quoteTotalCents: 220000 })");
});
