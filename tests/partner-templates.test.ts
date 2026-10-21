import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { INSTALLER_TEMPLATE, PARTNER_TEMPLATES, REC_TEMPLATE, renderPartnerTemplate } from "../src/lib/partner-templates";

const logoOf = (h: string) => /img class="logo" src="([^"]+)"/.exec(h)?.[1];
const styleOf = (h: string) => /<style>[\s\S]*?<\/style>/.exec(h)?.[0];

describe("partner invitation templates", () => {
  test("installer invitation metadata is exact", () => {
    expect(INSTALLER_TEMPLATE.label).toBe("Installer partnership invitation");
    expect(INSTALLER_TEMPLATE.subject).toBe("Hundreds of owner leads — let’s work together");
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

  test("copy: preheader, online portal, leads, referral highlight, no old sign-off", () => {
    const html = INSTALLER_TEMPLATE.html;
    expect(html).toContain("Your customers or our leads. We manage the VEU rebate process and help keep the paperwork off your plate. No lead fees.");
    expect(html).toContain("As your Accredited Person, Home Insulation Victoria manages the Victorian Energy Upgrades (VEU) rebate process and supports you from the initial enquiry through to completion.");
    expect(html).toContain("Bring us your own customers, set your installation price and help eligible customers access VEU savings. No lead fees.");
    expect(html).toContain("Your job information in one place");
    expect(html).toContain("Our online portal gives you access to job details, required documents and next steps, so you can see what each job needs.");
    expect(html).toContain('<strong style="color:#22376B;background:#FFDDEB;">We take care of the paperwork, so you can focus on installing.</strong> We handle customer quotes');
    expect(html).toContain("Tell us where you work and how much capacity you have. We’ll confirm our rates with you before you accept jobs from us.");
    expect(html).toContain("then install approved jobs at Home Insulation Victoria’s rates.");
    expect(html).toContain("Your coverage. Your capacity.");
    expect(html).toContain("Have your ABN, insurance certificate and installer certification<br>details ready.");
    expect(html).toContain("We’ll review your business, insurance and installer certification, then confirm approval before allocating work.");
    expect(html).not.toContain("supplier rates");
    expect(html).not.toContain("agreed supplier rates");
    expect(html).not.toContain("proposed supplier rates");
    expect(html).not.toContain("and agreed rates");
    // No in-app messaging claims and no "app" wording: the job view is the online portal.
    expect(html).not.toMatch(/\bapp\b/i);
    expect(html).not.toContain("manage bookings and messages");
    expect(html).not.toContain("You bring the installation expertise");
    expect(html).not.toContain("enquiries");
    expect(html).toContain("owner leads.");
    expect(html).toContain('<strong style="color:#22376B;background:#FFDDEB;">Know another great installer?</strong>');
    expect(html).not.toMatch(/HI VIC|HIVIC|JOIN OUR INSTALLER NETWORK|Kind regards|Warm regards/);
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });
});
