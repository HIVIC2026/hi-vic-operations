import { describe, expect, test } from "bun:test";
import { MASK, maskContactDetails } from "../src/lib/messaging.core";

describe("maskContactDetails", () => {
  test("masks mobile, landline, +61 and email", () => {
    for (const s of ["call 0412 345 678", "ring (03) 9876 5432", "+61 412 345 678", "me@x.com.au"]) {
      const r = maskContactDetails(s);
      expect(r.masked).toBe(true);
      expect(r.body).toContain(MASK);
    }
  });
  test("leaves ordinary text, times and areas alone", () => {
    for (const s of ["Tuesday 10:30 works", "about 150 m2", "30 Dash St 3336"]) {
      expect(maskContactDetails(s)).toEqual({ body: s, masked: false });
    }
  });
});
