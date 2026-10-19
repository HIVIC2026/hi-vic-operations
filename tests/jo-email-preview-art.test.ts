/**
 * Jo T1–T8: Office Templates preview must show the SAME campaign artwork as a real send,
 * but via a safe preview-only source that carries NO real customer estimate token.
 *
 * PURE: renders through the same functions every send uses. No database, no provider, no sending.
 */
import { describe, expect, test } from "bun:test";
import {
  renderJoOutcomeEmail,
  renderJoReadyCheckInvitationEmail,
  type JoOutcomeEmailInput,
} from "../src/lib/jo-outcome-email.core";
import { withUnsubscribe } from "../src/lib/emailsafety.core";

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

describe("A. preview path uses the safe preview-only art source (no real token)", () => {
  test("T2 preview art points to /api/public/email-art-preview/headline.png and never a customer token", () => {
    const m = withUnsubscribe(
      renderJoOutcomeEmail({
        outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient: RECIPIENT,
        figures: figures(210, false), links: LINKS,
        previewArtSrc: "/api/public/email-art-preview/headline.png",
      })!, UNSUB,
    );
    expect(m.html).toContain('src="/api/public/email-art-preview/headline.png"');
    // No real customer token in the rendered art URL.
    expect(m.html).not.toContain("/api/public/email-art/tok/");
    // The shared Spot Saved visual system is still present.
    expect(m.html).toContain('class="hiv-main lx-main"');
    expect(m.html).not.toContain('class="lx-badge"');
  });

  test("T8 preview art points to /api/public/email-art-preview/spot.png", () => {
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

  test("T7 (ineligible) stays logo-only even when no preview art source is given (no misleading rebate art)", () => {
    const m = withUnsubscribe(
      renderJoOutcomeEmail({
        outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, recipient: RECIPIENT,
        reason: "Built after 2010.", links: LINKS,
        previewArtSrc: "/api/public/email-art-preview/headline.png",
      })!, UNSUB,
    );
    // T7 deliberately keeps the logo-only header regardless of previewArtSrc.
    expect(m.html).toContain("hiv-logo");
    expect(m.html).not.toContain("/api/public/email-art-preview/");
    expect(m.html).not.toContain("/api/public/email-art/");
  });
});

describe("B. send path (no previewArtSrc) is untouched and still token-based", () => {
  test("T2 with no previewArtSrc keeps the real customer endpoint URL", () => {
    const m = withUnsubscribe(
      renderJoOutcomeEmail({
        outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient: RECIPIENT,
        figures: figures(210, false), links: LINKS,
      })!, UNSUB,
    );
    expect(m.html).toContain("/api/public/email-art/");
    expect(m.html).toContain("/headline.png");
  });
});

describe("C. preview art matches the real email's artwork kind", () => {
  test("preview headline art is the same 'likely' hero the real send draws (caps + green amount)", () => {
    const preview = withUnsubscribe(
      renderJoOutcomeEmail({
        outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient: RECIPIENT,
        figures: figures(210, false), links: LINKS,
        previewArtSrc: "/api/public/email-art-preview/headline.png",
      })!, UNSUB,
    );
    const send = withUnsubscribe(
      renderJoOutcomeEmail({
        outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient: RECIPIENT,
        figures: figures(210, false), links: LINKS,
      })!, UNSUB,
    );
    // Both render the same artwork row (campaignArtImg, natural width 354px); only the src differs.
    expect(preview.html).toContain('width="354"');
    expect(send.html).toContain('width="354"');
    // Alt text (Jo's first heading) is identical — the design is the same, just a different source.
    const alt = (h: string) => (h.match(/alt="([^"]*)"/) ?? [])[1] ?? null;
    expect(alt(preview.html)).toBe(alt(send.html));
    expect(alt(preview.html)).toBe("Hi Alex,");
  });
});

describe("D. preview art source is derived safely in the Office hub component", () => {
  test("template-hub.tsx selects the preview endpoint per template and never a customer token", () => {
    const src = require("node:fs").readFileSync("src/components/portal/template-hub.tsx", "utf8");
    expect(src).toContain('const previewArtSrc = templateId === "ineligible" ? null');
    expect(src).toContain('/api/public/email-art-preview/${templateId === "ready_check_invitation" ? "spot" : "headline"}.png');
    expect(src).toContain('previewArtSrc });'); // T1–T6 pass it through
    expect(src).toContain(', previewArtSrc);'); // T8 passes it through
  });
});
