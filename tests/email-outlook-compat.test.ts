import { describe, expect, test } from "bun:test";
import { renderEstimateEmail, renderIneligibleOutcomeEmail, TEST_BANNER_SLOT } from "../src/lib/estimate-email";

const base = {
  estimateUrl: "https://quote.homeinsulationvictoria.com.au/estimate/abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
  firstName: "Jo", address: "30 Dash St, Fraser Rise VIC 3336", areaM2: 150, installationPrice: 4500, installationRatePerM2: 30,
  assessmentFee: 349, apFee: 349, grossProjectTotal: 5198, veuDiscount: 1481.76, estimatedTotal: 3716.24,
  amountPayableNow: 0, estimatedRemainingBalance: 3716.24, reference: "REF-1",
};
const emails = {
  likely: renderEstimateEmail({ ...base, outcome: "likely" } as never).html,
  onsite: renderEstimateEmail({ ...base, outcome: "onsite", reasons: ["Roof access needs to be checked."] } as never).html,
  ineligible: renderIneligibleOutcomeEmail({ referralUrl: `https://homeinsulationvictoria.com.au/homeowner?ref=${"R".repeat(43)}`, reasons: ["The property is not in Victoria."], reference: "REF-1" } as never).html,
};

describe("Outlook compatibility", () => {
  for (const [name, html] of Object.entries(emails)) {
    test(`${name}: preheader hidden from MSO`, () => {
      const i = html.indexOf("<body");
      const body = html.slice(i);
      expect(body).toMatch(/^<body[^>]*><!--\[if !mso\]><!--><div style="display:none!important;visibility:hidden;mso-hide:all;[^"]*">[^<]*<\/div><!--<!\[endif\]-->/);
    });
    test(`${name}: hero is Outlook-safe, single heading, exactly once`, () => {
      expect((html.match(/<h1\b/g) ?? []).length).toBe(name === "likely" ? 1 : 0);
      const heroes = html.match(/<(?:div|h1) class="[^"]*hiv-hero-title[^"]*"[^>]*>/g) ?? [];
      expect(heroes.length).toBe(1);
      expect(heroes[0]).toContain("mso-line-height-rule:exactly");
      expect(heroes[0]).toMatch(/line-height:\d+px/);
    });
    test(`${name}: test banner slot inside the 640 body before logo; safe markup`, () => {
      const slot = html.indexOf(TEST_BANNER_SLOT);
      expect(slot).toBeGreaterThan(html.indexOf("max-width:640px"));
      expect(slot).toBeLessThan(html.indexOf("hiv-logo\""));
      expect(html).not.toMatch(/<script|\son[a-z]+=/i);
      const plain = html.replaceAll("<!--[if !mso]><!-->", "").replaceAll("<!--<![endif]-->", "").replace(/<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g, "");
      expect((plain.match(/<!--/g) ?? []).length).toBe((plain.match(/-->/g) ?? []).length);
    });
  }
});
