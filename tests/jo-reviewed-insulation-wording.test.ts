// Pure render checks only: no database, queues, network or delivery.
// Decision 67 (24 Oct 2026): reviewed below-R2 owners get the approved "some insulation" Save my spot email.
import { expect, test } from "bun:test";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";

const intro = "You told us there's some insulation in your ceiling already. If it's thin or patchy (below R2.0), you can still get the Victorian Government's Energy Upgrades (VEU) rebate.";
const retention = "it may be able to stay.";
const removal = "If some needs removing";

for (const known of [false, true]) {
  test(`T${known ? 4 : 3}: reviewed loose-fill or apparent under-R2 remains provisional; removal shown as a separate card`, () => {
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
      expect(output).toContain(intro);
      expect(output).toContain(retention);
      expect(output).toContain(removal);
      expect(output).toContain("may qualify");
      expect(output).not.toMatch(/below\s*R2\b(?!\.0)/i);
      expect(output).toContain("$5,179");
      expect(output).toContain("$3,697");
    }
  });
}
