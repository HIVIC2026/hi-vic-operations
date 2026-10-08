// THE ONLY source for the Save my spot (likely eligible) email (Jo, 7 Oct 2026 17:22 UTC):
// the Step 3 email preview, every real send, every "send test to me" button and every other
// preview call renderStep3SaveSpot with the job's facts. Never call renderSaveSpotFromLikelyEmail
// anywhere else (guarded by tests/step3-email-parity.test.ts).
import { renderEstimateEmail, renderSaveSpotFromLikelyEmail, type EstimateEmail } from "./estimate-email";
import { withUnsubscribe } from "./emailsafety.core";
import type { EstimateRemoval } from "./estimate-removal.core";

export type SaveSpotFacts = {
  estimateUrl: string;
  campaignUrl: string;
  unsubscribeUrl: string;
  estimatedTotal: number;
  veuDiscount: number;
  grossTotal: number;
  areaM2: number;
  areaIsTypical?: boolean;
  firstName: string | null;
  address: string | null;
  reference: string | null;
  existingInsulationPresent: boolean;
  removal?: EstimateRemoval;
  referralUrl?: string | null;
  installation?: number;
  assessmentFee?: number;
  apFee?: number;
};

function likelyInput(f: SaveSpotFacts) {
  return {
    estimateUrl: f.estimateUrl, outcome: "likely" as const, apCount: 2, referralUrl: f.referralUrl ?? null,
    estimatedTotal: f.estimatedTotal, veuDiscount: f.veuDiscount, grossProjectTotal: f.grossTotal, areaM2: f.areaM2,
    ...(f.areaIsTypical === undefined ? {} : { areaIsTypical: f.areaIsTypical }),
    amountPayableNow: 0, estimatedRemainingBalance: f.estimatedTotal,
    firstName: f.firstName, address: f.address, reference: f.reference, existingInsulationPresent: f.existingInsulationPresent,
    assessmentFee: f.assessmentFee ?? 349, apFee: f.apFee ?? 349,
    installationPrice: f.installation ?? f.grossTotal - (f.assessmentFee ?? 349) - (f.apFee ?? 349),
  };
}

/** Step 3 "Likely eligible" email for these facts. */
export function renderStep3Likely(f: SaveSpotFacts): EstimateEmail {
  return withUnsubscribe(renderEstimateEmail(likelyInput(f)), f.unsubscribeUrl);
}

/** Save your spot = the Step 3 likely email for the same facts with ONLY the four pink-box swaps. */
export function renderStep3SaveSpot(f: SaveSpotFacts): EstimateEmail {
  return withUnsubscribe(renderSaveSpotFromLikelyEmail({ ...likelyInput(f), campaignUrl: f.campaignUrl, ...(f.removal && f.existingInsulationPresent ? { saveSpotRemoval: f.removal } : {}) }), f.unsubscribeUrl);
}

/** Missing-size template only. Supplied prices/rebate must be calculated for the assumed area; never changes owner answers or sends. */
export function renderStep3SaveSpotNoSize(f: Omit<SaveSpotFacts, "areaM2" | "areaIsTypical">): EstimateEmail {
  return renderStep3SaveSpot({ ...f, areaM2: 150, areaIsTypical: true });
}

/** Lines that differ between the two (plain text), old next to new. */
export function saveSpotDifferences(f: SaveSpotFacts): { before: string; after: string }[] {
  const a = renderStep3Likely(f).plainText.split("\n"), b = renderStep3SaveSpot(f).plainText.split("\n");
  const out: { before: string; after: string }[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push({ before: a[i] ?? "", after: b[i] ?? "" });
  return out;
}

// Step 3 preview sample (postcode 3336, 150 m², standard access, settings v2). Same numbers the page shows.
const SAMPLE_INSTALL = 4500, SAMPLE_DISCOUNT = 1481.76, PIESA_FEE = 349, AP_FEE = 349;
const SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE;
const SAMPLE_ESTIMATE_URL = "https://estimate.homeinsulationvictoria.com.au/estimate/sample-secure-link";
export const STEP3_SAVESPOT_SAMPLE: SaveSpotFacts = {
  estimateUrl: SAMPLE_ESTIMATE_URL, campaignUrl: `${SAMPLE_ESTIMATE_URL}/campaign`,
  unsubscribeUrl: `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`,
  estimatedTotal: SAMPLE_GROSS - SAMPLE_DISCOUNT, veuDiscount: SAMPLE_DISCOUNT, grossTotal: SAMPLE_GROSS, areaM2: 150,
  referralUrl: `https://homeinsulationvictoria.com.au/homeowner?ref=${"R".repeat(43)}`,
  firstName: "Alex", address: "30 Dash St, Fraser Rise VIC 3336", reference: "SAMPLE-1001", existingInsulationPresent: false,
  installation: SAMPLE_INSTALL, assessmentFee: PIESA_FEE, apFee: AP_FEE,
};
