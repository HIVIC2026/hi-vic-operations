import { expect, test } from "bun:test";
import { qaNoDelivery } from "../src/lib/qa-no-delivery.core";
test("run-owned TEST delivery hold cannot alter real-job delivery", () => {
  expect(qaNoDelivery("qa_test", { qa_no_delivery: true })).toBe(true);
  expect(qaNoDelivery("website", { qa_no_delivery: true })).toBe(false);
  expect(qaNoDelivery("qa_test", {})).toBe(false);
});