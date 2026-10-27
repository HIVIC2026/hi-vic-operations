import { expect, test } from "bun:test";
import { CUSTOMER_APPROVAL_REASSURANCE as CAR, CUSTOMER_WHAT_COULD_CHANGE as WCC } from "../src/lib/customer-quote-system";
import { HEADING_ART } from "../src/lib/email-art.core";
import { measureHeading } from "../src/lib/email-hero.core";

// The retired outcome emails (renderEstimateEmail / renderIneligibleOutcomeEmail) were deleted on 27 Oct 2026:
// no send path used them; customers get renderJoOutcomeEmail.
test("one shared approval reassurance", () => {
  expect(WCC.closing).toBe(CAR);
});
test("v7 heading art sizes match the bundled fonts", () => {
  for (const a of Object.values(HEADING_ART)) expect(measureHeading(a.text, a.style)).toEqual({ w: a.w, h: a.h });
});
