import { expect, test } from "bun:test";
import { tradeBlockerLines } from "../src/lib/portal-presentation.core";
test("office blockers become plain trade lines, no office stage names", () => {
  const out = tradeBlockerLines(["Free Ready Check eligibility measure-up not yet completed by the installer.", "Verified eligibility not recorded as eligible by the office for the current Ready Check.", "Blocking Measured Estimate Ready"]);
  expect(out).toEqual(["Waiting for the office to check your Ready Check"]);
  expect(tradeBlockerLines(["Verified eligibility not recorded"])).toEqual(["Waiting for the office to confirm the owner is eligible"]);
});
