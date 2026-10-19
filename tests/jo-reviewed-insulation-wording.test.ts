// Pure render checks only: no database, queues, network or delivery.
import { expect, test } from "bun:test";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";

const reviewedIntro = "Thanks for sending through your photos or video. We’ve reviewed them and, based on what is visible, your existing insulation appears potentially suitable for the VEU upgrade. Your free Ready Check will confirm the existing insulation and final eligibility.";
const retention = "Some existing insulation may be able to stay, while other areas may need removal. We’ll assess this at your free Ready Check.";
const removal = "Please budget $15 per m² including GST for the areas that need removal only. Removal is not included in this preliminary quote. We’ll confirm the area and cost for your approval before any removal proceeds.";

for (const known of [false, true]) {
  test(`T${known ? 4 : 3}: reviewed loose-fill or apparent under-R2 remains provisional; removal unchanged`, () => {
    const email = renderJoOutcomeEmail({
      outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: known,
      deskCheckStatus: "looks_eligible",
      recipient: { firstName: "Alex", propertyAddress: "Example property", enquiryReference: "TEST-RENDER" },
      figures: { veuRebate: 1481.76, customerTotal: 3697.24, totalBeforeRebate: 5179,
        installation: 4481, piesaFee: 349, apFee: 349, ceilingAreaM2: 150, areaEstimated: !known },
      links: {
        saveMySpotUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/example/campaign",
        uploadMediaUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/example/video",
        reviewResultUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/example",
        calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/calculator",
      },
    });
    if (!email) throw new Error("Reviewed T3/T4 email was not rendered");
    expect(email.templateId).toBe(known ? "eligible_below_r2_reviewed_size_known" : "eligible_below_r2_reviewed_size_unknown");
    for (const output of [email.html, email.plainText]) {
      expect(output).toContain(reviewedIntro);
      expect(output).toContain(retention);
      expect(output).toContain(removal);
      expect(output).not.toMatch(/below\s*R2/i);
      expect(output).toContain("$5,179");
      expect(output).toContain("$3,697");
    }
  });
}