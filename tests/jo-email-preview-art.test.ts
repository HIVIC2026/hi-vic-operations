/**
 * Jo T1–T7: the Office Templates preview renders the SAME email as a real send.
 * Decision 137 (24 Oct 2026): T1–T7 use the approved kit design, whose header is the embedded logo PNG — there is no
 * per-customer campaign artwork any more, so a preview can never leak a real customer token. T8 (the office Ready
 * Check invitation) and the Office-only preview artwork endpoint were retired on 24 Oct 2026.
 *
 * PURE: renders through the same functions every send uses. No database, no provider, no sending.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";
import { withUnsubscribe } from "../src/lib/emailsafety.core";
import { MAIL_LOGO_URL } from "../src/lib/mail-mjml.core";

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

describe("A. the approved emails show only the embedded logo (no customer token in any image)", () => {
  test("T2 shows only the embedded logo", () => {
    const send = withUnsubscribe(renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient: RECIPIENT, figures: figures(210, false), links: LINKS })!, UNSUB);
    expect(imgSources(send.html)).toEqual([MAIL_LOGO_URL]);
    expect(send.html).not.toContain("data:image");
    expect(send.html).not.toContain("/api/public/email-art");
  });

  test("T7 (ineligible) stays logo-only (no misleading rebate art)", () => {
    const m = withUnsubscribe(
      renderJoOutcomeEmail({
        outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, recipient: RECIPIENT,
        reason: "Built after 2010.", links: LINKS,
      })!, UNSUB,
    );
    expect(imgSources(m.html)).toEqual([MAIL_LOGO_URL]);
    expect(m.html).not.toContain("data:image");
    expect(m.html).not.toContain("/api/public/email-art");
  });
});

describe("B. the retired Office preview artwork is gone", () => {
  test("no preview-art endpoint, and the Templates hub never builds a preview-art source", () => {
    expect(existsSync("src/routes/api/public/email-art-preview.$kind.ts")).toBe(false);
    const hub = readFileSync("src/components/portal/template-hub.tsx", "utf8");
    expect(hub).not.toContain("email-art-preview");
    expect(hub).not.toContain("previewArtSrc");
    expect(readFileSync("src/routeTree.gen.ts", "utf8")).not.toContain("email-art-preview");
  });
});
