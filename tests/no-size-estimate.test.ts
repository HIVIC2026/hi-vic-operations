import { test, expect } from "bun:test";
import { noSizeEstimateBlocker } from "../src/lib/no-size-estimate.core";
import { automaticLeadEmail } from "../src/lib/enquiry-groups.core";
import { renderStep3SaveSpot, renderStep3SaveSpotNoSize } from "../src/lib/step3-emails";
const ok = { areaSource: "typical_default", areaM2: 150, ownerArea: null, insulation: "none", followup: false, automaticInitial: true };
const base = { source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, outcome: "likely_eligible", intakeWorkActive: false, declaredInsulation: "none" as const };
test("no owner size routes to the first reply on the typical area", () => expect(automaticLeadEmail({ ...base, ownerEnteredArea: false })).toEqual({ email: "offer_spot", blocker: null, assumedArea: true }));
test("owner size route unchanged", () => expect(automaticLeadEmail({ ...base, ownerEnteredArea: true })).toEqual({ email: "offer_spot", blocker: null }));
test("TEST and review-required still hold", () => { expect(automaticLeadEmail({ ...base, source: "qa_test", ownerEnteredArea: false }).email).toBe("none"); expect(automaticLeadEmail({ ...base, reviewRequired: true, ownerEnteredArea: false }).email).toBe("none"); });
test("existing insulation never uses the no-size route", () => expect(automaticLeadEmail({ ...base, declaredInsulation: "present", ownerEnteredArea: false }).email).toBe("request_insulation"));
test("allowed only as automatic first reply", () => { expect(noSizeEstimateBlocker(ok)).toBeNull(); expect(noSizeEstimateBlocker({ ...ok, automaticInitial: false })).not.toBeNull(); });
test("owner size entered later blocks stale typical estimate", () => expect(noSizeEstimateBlocker({ ...ok, ownerArea: 120 })).not.toBeNull());
test("wrong area or insulation blocks", () => { expect(noSizeEstimateBlocker({ ...ok, areaM2: 140 })).not.toBeNull(); expect(noSizeEstimateBlocker({ ...ok, insulation: "present" })).not.toBeNull(); expect(noSizeEstimateBlocker({ ...ok, followup: true })).not.toBeNull(); });
test("measured/owner estimates unaffected", () => expect(noSizeEstimateBlocker({ ...ok, areaSource: "owner_estimate", automaticInitial: false })).toBeNull());
test("sender render equals the approved no-size template", () => {
  const f = { estimateUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok123", campaignUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok123/campaign", unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=abcdefghijklmnopqrstuv", estimatedTotal: 1234, veuDiscount: 1470, grossTotal: 2704, firstName: "A", address: "1 St VIC 3000", reference: "HV-1", existingInsulationPresent: false };
  const a = renderStep3SaveSpot({ ...f, areaM2: 150, areaIsTypical: true }), b = renderStep3SaveSpotNoSize(f);
  expect(a.html).toBe(b.html); expect(a.plainText).toBe(b.plainText); expect(a.subject).toBe(b.subject);
});
