import { expect, test } from "bun:test";
import { quoteTotalsMismatch } from "../src/lib/quote-totals.core";

const q = { subtotal_inc_gst: 3000, veec_discount_inc_gst: 1470, customer_total_inc_gst: 1530 };

test("match: lines = subtotal and subtotal - rebate = owner price", () => {
  expect(quoteTotalsMismatch(q, [{ line_total_inc_gst: 2000 }, { line_total_inc_gst: 1000 }])).toBeNull();
});
test("within a cent is fine", () => {
  expect(quoteTotalsMismatch(q, [{ line_total_inc_gst: 2000 }, { line_total_inc_gst: 1000.01 }])).toBeNull();
  expect(quoteTotalsMismatch({ ...q, customer_total_inc_gst: 1530.01 }, [{ line_total_inc_gst: 3000 }])).toBeNull();
});
test("lines differ from subtotal gives a reason", () => {
  expect(quoteTotalsMismatch(q, [{ line_total_inc_gst: 3200 }])).toMatch(/lines add up to \$3200\.00 but the subtotal is \$3000\.00/);
  expect(quoteTotalsMismatch(q, [])).toMatch(/lines add up to \$0\.00/);
});
test("subtotal minus rebate differs from owner price gives a reason", () => {
  expect(quoteTotalsMismatch({ ...q, customer_total_inc_gst: 0 }, [{ line_total_inc_gst: 3000 }])).toMatch(/owner price is \$0\.00/);
});
test("non-numbers are a mismatch", () => {
  expect(quoteTotalsMismatch({ ...q, subtotal_inc_gst: NaN }, [{ line_total_inc_gst: 3000 }])).not.toBeNull();
});
