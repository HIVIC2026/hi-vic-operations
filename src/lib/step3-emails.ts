// THE ONLY source for the Save my spot (likely eligible) email (Jo, 7 Oct 2026 17:22 UTC):
// the Step 3 email preview, every real send, every "send test to me" button and every other
// preview call renderStep3SaveSpot with the job's facts. Never call renderSaveSpotFromLikelyEmail
// anywhere else (guarded by tests/step3-email-parity.test.ts).
import { renderSaveSpotFromLikelyEmail, type EstimateEmail } from "./estimate-email";

export type SaveSpotFacts = {
  estimateUrl: string;
  campaignUrl: string;
  unsubscribeUrl: string;
  estimatedTotal: number;
  veuDiscount: number;
  grossTotal: number;
  areaM2: number;
  firstName: string | null;
  address: string | null;
  reference: string | null;
  existingInsulationPresent: boolean;
  installation?: number;
  assessmentFee?: number;
  apFee?: number;
};

export function renderStep3SaveSpot(f: SaveSpotFacts): EstimateEmail {
  return renderSaveSpotFromLikelyEmail({
    estimateUrl: f.estimateUrl, outcome: "likely", apCount: 2, campaignUrl: f.campaignUrl, campaignOptOutUrl: f.unsubscribeUrl,
    estimatedTotal: f.estimatedTotal, veuDiscount: f.veuDiscount, grossProjectTotal: f.grossTotal, areaM2: f.areaM2,
    amountPayableNow: 0, estimatedRemainingBalance: f.estimatedTotal,
    firstName: f.firstName, address: f.address, reference: f.reference, existingInsulationPresent: f.existingInsulationPresent,
    ...(f.installation === undefined ? {} : { installationPrice: f.installation }),
    ...(f.assessmentFee === undefined ? {} : { assessmentFee: f.assessmentFee }),
    ...(f.apFee === undefined ? {} : { apFee: f.apFee }),
  });
}
