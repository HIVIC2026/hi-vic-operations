// Sample facts for the two customer email previews the office Templates hub still shows outside Jo's approved
// enquiry set: the three-day "estimate not opened" reminder and the "not in your area yet" email. Renderers and
// wording are the real ones; nothing here sends. The superseded Step 3 samples (likely, Save your spot, onsite,
// ineligible) were removed on 24 Oct 2026 with their renderers.
import { renderFollowupEmail } from "./followup-email";
import { renderCoverageUnavailableEmail } from "./coverage-email";
import { withUnsubscribe } from "./emailsafety.core";

export const estimateUrl = "https://estimate.homeinsulationvictoria.com.au/estimate/sample-secure-link";
export const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${"R".repeat(43)}`;
export const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
export const samples = {
  reminder3: withUnsubscribe(renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl, referralUrl }), unsubscribeUrl),
  coverage: withUnsubscribe(renderCoverageUnavailableEmail({ firstName: "Alex", suburb: "Fraser Rise", postcode: "3336", missing: ["installer"], reference: "SAMPLE-1001" }), unsubscribeUrl),
};
