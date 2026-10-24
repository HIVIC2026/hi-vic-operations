/**
 * Jo T1–T8: the Office Templates preview renders the SAME email as a real send.
 * Decision 137 (24 Oct 2026): T1–T7 use the approved kit design, whose header is the embedded logo PNG — there is no
 * per-customer campaign artwork any more, so a preview can never leak a real customer token. T8 (the retired office
 * Ready Check invitation) keeps the earlier art header and the safe preview source.
 *
 * PURE: renders through the same functions every send uses. No database, no provider, no sending.
 */
import { describe, expect, test } from "bun:test";
import {
  renderJoOutcomeEmail,
  renderJoReadyCheckInvitationEmail,
} from "../src/lib/jo-outcome-email.core";
import { withUnsubscribe } from "../src/lib/emailsafety.core";
import { LOGO_DATA_URI } from "../src/lib/email-kit.core";

const RECIPIENT = { firstName: "Alex", propertyAddress: "12 Sample St, Melbourne VIC 3000", enquiryReference: "HV-0000" };
const LINKS = {
  saveMySpotUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/campaign",
  uploadMediaUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/video",
  reviewResultUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
  calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok#calculator",
};
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
const figures = (area: number, estimated: boolean) => ({
  veuRebate: 2600, customerTotal: 1900, totalBeforeRebate: 4500, installation: 3800, piesaFee: 350, apFee: 350, ceilingAreaM2: area, areaEstimated: estimated,
});
const imgSources = (html: string) => Array.from(html.matchAll(/<img[^>]+src="([^"]+)"/g), (m) => m[1]);

describe("A. preview and send render the identical approved email (no customer token in any image)", () => {
  test("T2 preview (previewArtSrc given) and send (none) are byte-identical and show only the embedded logo", () => {
    const base = { outcome: "likely_eligible" as const, insulation: "none" as const, ceilingSizeKnown: true, recipient: RECIPIENT, figures: figures(210, false), links: LINKS };
    const preview = withUnsubscribe(renderJoOutcomeEmail({ ...base, previewArtSrc: "/api/public/email-art-preview/headline.png" })!, UNSUB);
    const send = withUnsubscribe(renderJoOutcomeEmail(base)!, UNSUB);
    expect(preview.html).toBe(send.html);
    expect(imgSources(send.html)).toEqual([LOGO_DATA_URI]);
    expect(send.html).not.toContain("/api/public/email-art");
  });

  test("T7 (ineligible) stays logo-only even when a preview art source is given (no misleading rebate art)", () => {
    const m = withUnsubscribe(
      renderJoOutcomeEmail({
        outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, recipient: RECIPIENT,
        reason: "Built after 2010.", links: LINKS,
        previewArtSrc: "/api/public/email-art-preview/headline.png",
      })!, UNSUB,
    );
    expect(imgSources(m.html)).toEqual([LOGO_DATA_URI]);
    expect(m.html).not.toContain("/api/public/email-art-preview/");
    expect(m.html).not.toContain("/api/public/email-art/");
  });

  test("T8 preview art points to /api/public/email-art-preview/spot.png (earlier presentation retained)", () => {
    const m = withUnsubscribe(
      renderJoReadyCheckInvitationEmail(RECIPIENT, {
        ...figures(150, true), savedAt: "2026-10-19T00:00:00Z",
        personalEstimateUrl: "https://estimate.homeinsulationvictoria.com.au/my-estimate/tok",
        readyCheckBookingUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
      }, "/api/public/email-art-preview/spot.png"), UNSUB,
    );
    expect(m.html).toContain('src="/api/public/email-art-preview/spot.png"');
    expect(m.html).not.toContain("/api/public/email-art/tok/");
  });
});

describe("B. preview art source is derived safely in the Office hub component", () => {
  test("template-hub.tsx selects the preview endpoint per template and never a customer token", () => {
    const src = require("node:fs").readFileSync("src/components/portal/template-hub.tsx", "utf8");
    expect(src).toContain('const previewArtSrc = templateId === "ineligible" ? null');
    expect(src).toContain('/api/public/email-art-preview/${templateId === "ready_check_invitation" ? "spot" : "headline"}.png');
    expect(src).toContain('previewArtSrc });'); // T1–T6 pass it through (ignored by the approved design)
    expect(src).toContain(', previewArtSrc);'); // T8 passes it through
  });
});
