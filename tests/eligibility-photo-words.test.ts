import { expect, test } from "bun:test";
import { eligibilityWords, PHOTOS_TO_BE_CHECKED } from "../src/lib/job-wording";

// Jo 7 Nov: photo (firm-quote) jobs say "Photos to be checked by installer" instead of "Needs Onsite Confirmation".
test("photo job that needs confirming reads 'Photos to be checked by installer'", () => {
  expect(PHOTOS_TO_BE_CHECKED).toBe("Photos to be checked by installer");
  expect(eligibilityWords("needs_onsite_confirmation", true)).toBe("Photos to be checked by installer");
});
test("jobs without photos stay as they are", () => {
  expect(eligibilityWords("needs_onsite_confirmation", false)).toBe("Needs Onsite Confirmation");
});
test("other results never change, photos or not", () => {
  expect(eligibilityWords("likely_eligible", true)).toBe("Likely Eligible");
  expect(eligibilityWords("does_not_appear_eligible", true)).toBe("Does Not Appear Eligible");
});
