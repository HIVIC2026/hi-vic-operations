import { expect, test } from "bun:test";
import { firmQuoteInstallerBlocker, firmQuoteRequestDueBy, firmQuoteRequestTag } from "../src/lib/firm-quote.core";

test("firm request tag uses its recorded due date", () => {
  const date = firmQuoteRequestDueBy([{ event_type: "firm_quote_requested", details: { due_by: "2026-11-17" } }]);
  expect(date).toBe("2026-11-17");
  expect(firmQuoteRequestTag(date)).toBe("Asked for firm quote · due Tuesday 17 November");
  expect(firmQuoteRequestDueBy([{ event_type: "other", details: { due_by: "2026-11-17" } }])).toBeNull();
});
test("photos installer allowed; Ready Check refused with exact reason", () => {
  expect(firmQuoteInstallerBlocker(true, { quote_method: "photos" })).toBeNull();
  expect(firmQuoteInstallerBlocker(true, { quote_method: "ready_check" })).toBe("Firm quote jobs go to installers who quote from photos.");
  expect(firmQuoteInstallerBlocker(true, {})).toBe("Firm quote jobs go to installers who quote from photos.");
});
test("normal jobs keep all current quote methods and no firm tag", () => {
  expect(firmQuoteInstallerBlocker(false, { quote_method: "ready_check" })).toBeNull();
  expect(firmQuoteRequestTag(null)).toBeNull();
});