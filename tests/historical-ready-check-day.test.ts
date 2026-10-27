import { expect, test } from "bun:test";
import { historicalReadyCheckDay } from "../src/lib/trade-view.core";
test("installation scheduling must not reopen the old Ready Check visit", () => {
  expect(historicalReadyCheckDay("installation_scheduling", "ready_check")).toBe(true);
  expect(historicalReadyCheckDay("piesa_scheduled", "ready_check")).toBe(true);
  expect(historicalReadyCheckDay("ready_check_ready_to_schedule", null)).toBe(true);
});
test("a current Ready Check and a booked installation keep their day pages", () => {
  expect(historicalReadyCheckDay("ready_check_scheduled", "ready_check")).toBe(false);
  expect(historicalReadyCheckDay("installation_booked", "installation")).toBe(false);
});