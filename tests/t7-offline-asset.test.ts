import { expect, test } from "bun:test";
import { LOGO_PNG } from "../src/lib/email-hero-assets";
import { readPng } from "../src/lib/png-lite.core";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";

test("T7 ships the same complete PNG logo bytes used by the campaign artwork, without a remote image dependency", () => {
  const mail = renderJoOutcomeEmail({
    outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false,
    reason: "Office-confirmed ineligibility", recipient: { firstName: "Alex", propertyAddress: "TEST property", enquiryReference: "TEST" },
    links: { saveMySpotUrl: "", uploadMediaUrl: "", reviewResultUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/TEST", calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/calculator" },
  });
  if (!mail) throw new Error("Expected T7");
  const sources = Array.from(mail.html.matchAll(/<img[^>]+src="([^"]+)"/g), m => m[1]);
  expect(sources).toEqual([`data:image/png;base64,${LOGO_PNG}`]);
  const decoded = readPng(new Uint8Array(Buffer.from(LOGO_PNG, "base64")));
  expect(decoded.width).toBeGreaterThan(0);
  expect(decoded.height).toBeGreaterThan(0);
  expect(decoded.data.length).toBe(decoded.width * decoded.height * 4);
});