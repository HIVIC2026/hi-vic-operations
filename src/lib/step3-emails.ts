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
    assessmentFee: f.assessmentFee ?? 349, apFee: f.apFee ?? 349,
    installationPrice: f.installation ?? f.grossTotal - (f.assessmentFee ?? 349) - (f.apFee ?? 349),
  });
}

// Step 3 preview sample (postcode 3336, 150 m², standard access, settings v2). Same numbers the page shows.
const SAMPLE_INSTALL = 4500, SAMPLE_DISCOUNT = 1481.76, PIESA_FEE = 349, AP_FEE = 349;
const SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE;
const SAMPLE_ESTIMATE_URL = "https://estimate.homeinsulationvictoria.com.au/estimate/sample-secure-link";
export const STEP3_SAVESPOT_SAMPLE: SaveSpotFacts = {
  estimateUrl: SAMPLE_ESTIMATE_URL, campaignUrl: `${SAMPLE_ESTIMATE_URL}/campaign`,
  unsubscribeUrl: `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`,
  estimatedTotal: SAMPLE_GROSS - SAMPLE_DISCOUNT, veuDiscount: SAMPLE_DISCOUNT, grossTotal: SAMPLE_GROSS, areaM2: 150,
  firstName: "Alex", address: "30 Dash St, Fraser Rise VIC 3336", reference: "SAMPLE-1001", existingInsulationPresent: false,
  installation: SAMPLE_INSTALL, assessmentFee: PIESA_FEE, apFee: AP_FEE,
};
