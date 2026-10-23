import { expect, test } from "bun:test";
import { testQuoteNotification } from "../src/lib/quote-ready-test.core";
test("TEST email and SMS contain exact cents and the same owner quote link", () => {
  const url = "https://estimate.homeinsulationvictoria.com.au/my-job/test-token?screen=quote";
  const p = testQuoteNotification("HV-TEST", 3830.25, url);
  expect(p.text).toContain("$3,830.25 inc GST");
  expect(p.subject).toContain("$3,830.25 inc GST");
  expect(p.text).toContain(url);expect(p.html).toContain(url);
});
test("no guessed total or invalid owner link can become TEST notification", () => {
  expect(() => testQuoteNotification("HV-TEST", NaN, "https://example.org")).toThrow();
  expect(() => testQuoteNotification("HV-TEST", 3830.25, "/my-job/token")).toThrow();
});