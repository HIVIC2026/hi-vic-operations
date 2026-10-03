import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INSTALLER_TEMPLATE, PARTNER_TEMPLATES, REC_TEMPLATE, renderPartnerTemplate } from "../src/lib/partner-templates";

const logoOf = (h: string) => /img class="logo" src="([^"]+)"/.exec(h)?.[1];
const styleOf = (h: string) => /<style>[\s\S]*?<\/style>/.exec(h)?.[0];

describe("partner invitation templates", () => {
  test("installer invitation metadata is exact", () => {
    expect(INSTALLER_TEMPLATE.label).toBe("Installer partnership invitation");
    expect(INSTALLER_TEMPLATE.subject).toBe("Hundreds of homeowner leads — let’s work together");
    expect(INSTALLER_TEMPLATE.registrationUrl).toBe("https://estimate.homeinsulationvictoria.com.au/installer-onboarding");
    expect(PARTNER_TEMPLATES.map((t) => t.key)).toContain("installer_invitation");
  });

  test("portal HTML equals the canonical file byte-for-byte", () => {
    const file = readFileSync("src/lib/templates/installer-partnership-invitation.html", "utf8");
    expect(renderPartnerTemplate(INSTALLER_TEMPLATE)).toBe(file);
  });

  test("shares REC v7 logo and styles; CTA is the fresh public route", () => {
    const html = INSTALLER_TEMPLATE.html;
    expect(logoOf(html)).toBe(logoOf(REC_TEMPLATE.html));
    expect(styleOf(html)).toBe(styleOf(REC_TEMPLATE.html));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toContain("https://estimate.homeinsulationvictoria.com.au/installer-onboarding");
    expect(hrefs.some((h) => /installer-onboarding[?#/]/.test(h))).toBe(false);
  });

  test("copy: preheader, app, leads, referral highlight, no old sign-off", () => {
    const html = INSTALLER_TEMPLATE.html;
    expect(html).toContain("Your customers or our leads. One app to manage the job, with Home Insulation Victoria handling the rebate process. No lead fees.");
    expect(html).toContain("One app to keep the job moving");
    expect(html).toContain("homeowner leads.");
    expect(html).not.toMatch(/enquir/i);
    expect(html).toContain('<strong style="color:#22376B;background:#FFDDEB;">Know another great installer?</strong>');
    expect(html).not.toMatch(/HI VIC|HIVIC|JOIN OUR INSTALLER NETWORK|Kind regards|Warm regards/);
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });
});
