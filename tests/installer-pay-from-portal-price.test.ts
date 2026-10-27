import { describe, expect, test } from "bun:test";
import { installerPayExFor } from "../src/lib/job-margin.core";

// Jo 27 Oct 2026 (HV-3385): "of course we know the installer pay we have the quote" — on a job the installer brought in,
// the price they entered in the portal is what we pay them, so the margin must use it when nothing else is recorded.
describe("installer pay for the margin", () => {
  test("installer's own job with only the portal price uses that price (ex GST)", () => {
    expect(installerPayExFor({ recordedInc: null, quoteCostEx: null, portalPriceInc: 4500, installerSourced: true })).toBe(4090.91);
  });
  test("a recorded payout or offer still wins", () => {
    expect(installerPayExFor({ recordedInc: 3300, quoteCostEx: 2000, portalPriceInc: 4500, installerSourced: true })).toBe(3000);
  });
  test("the quote's agreed cost wins over the portal price", () => {
    expect(installerPayExFor({ recordedInc: null, quoteCostEx: 2000, portalPriceInc: 4500, installerSourced: true })).toBe(2000);
  });
  test("our own leads never use a portal price", () => {
    expect(installerPayExFor({ recordedInc: null, quoteCostEx: null, portalPriceInc: 4500, installerSourced: false })).toBeNull();
  });
  test("nothing known stays unknown", () => {
    expect(installerPayExFor({ recordedInc: null, quoteCostEx: null, portalPriceInc: null, installerSourced: true })).toBeNull();
  });
});
