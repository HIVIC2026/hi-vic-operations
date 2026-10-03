import { describe, expect, test } from "bun:test";
import { INSTALLER_TEMPLATE, PARTNER_TEMPLATES, renderPartnerTemplate } from "../src/lib/partner-templates";

describe("partner invitation templates", () => {
  test("installer invitation metadata is exact", () => {
    expect(INSTALLER_TEMPLATE.label).toBe("Installer partnership invitation");
    expect(INSTALLER_TEMPLATE.subject).toBe("Hundreds of homeowner enquiries—and we’re looking for great installers");
    expect(INSTALLER_TEMPLATE.registrationUrl).toBe("https://estimate.homeinsulationvictoria.com.au/installer-onboarding");
    expect(PARTNER_TEMPLATES.map((t) => t.key)).toContain("installer_invitation");
  });

  test("rendered HTML is standalone with embedded PNG and clean CTA link", () => {
    const html = renderPartnerTemplate(INSTALLER_TEMPLATE);
    expect(html).toBe(INSTALLER_TEMPLATE.html);
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo');
    expect(html).toContain('href="https://estimate.homeinsulationvictoria.com.au/installer-onboarding"');
    expect(html).toContain("JOIN OUR INSTALLER NETWORK");
    expect(html).toContain("INSTALLER PARTNER INVITATION");
    expect(html).toContain("No lead fees");
    expect(html).not.toContain("__LOGO_B64__");
    expect(html).not.toContain("__REG_URL__");
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });
});
