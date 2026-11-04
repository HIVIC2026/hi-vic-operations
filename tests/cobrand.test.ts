// Part 10 Task 5: co-brand helper (installer logo beside ours on an own customer's quote email, page and invoice) and the
// mjEmail header with an optional partner logo. One switch, OWN_CUSTOMER_COBRAND_APPROVED, ships off.
import { describe, expect, test } from "bun:test";
import { OWN_COBRAND_LOGO_WIDTH, OWN_CUSTOMER_COBRAND_APPROVED, cobrandLogos } from "../src/lib/cobrand.core";
import { MAIL_HEADER, MAIL_LOGO_URL, mjEmail, mjEmailSource } from "../src/lib/mail-mjml.core";

describe("cobrandLogos", () => {
  test("no logo / http logo / blank name → ours only", () => {
    expect(cobrandLogos({ installerName: "Rapid Insulation", logoUrl: null }).installer).toBeNull();
    expect(cobrandLogos({ installerName: "Rapid Insulation", logoUrl: "http://x/logo.png" }).installer).toBeNull();
    expect(cobrandLogos({ installerName: "Rapid Insulation", logoUrl: "  " }).installer).toBeNull();
    expect(cobrandLogos({ installerName: null, logoUrl: "https://x/logo.png" }).installer).toBeNull();
    expect(cobrandLogos({ installerName: " ", logoUrl: "https://x/logo.png" }).installer).toBeNull();
    expect(cobrandLogos({ installerName: "Rapid Insulation", logoUrl: "https://x/logo.png" }).installer).toEqual({ url: "https://x/logo.png", alt: "Rapid Insulation" });
  });
  test("switch ON at go-live 5 Nov 2026", () => { expect(OWN_CUSTOMER_COBRAND_APPROVED).toBe(true); });
});

describe("mjEmail partnerLogo", () => {
  const base = { subject: "S", preview: null, body: "<mj-section><mj-column><mj-text>hi</mj-text></mj-column></mj-section>", unsubscribe: null, testLabel: false };
  test("absent / null → today's header byte-for-byte", () => {
    const plain = mjEmail(base);
    expect(mjEmail({ ...base, partnerLogo: null })).toBe(plain);
    expect(mjEmail({ ...base, partnerLogo: undefined })).toBe(plain);
    expect(mjEmailSource(base)).toContain(MAIL_HEADER);
  });
  test("with a partner logo: our logo, then the installer's on the same row; alt = installer name; no empty img", () => {
    const html = mjEmail({ ...base, partnerLogo: { url: "https://x/rapid-logo.png", alt: "Rapid Insulation" } });
    expect(html).toContain(MAIL_LOGO_URL);
    expect(html).toContain("https://x/rapid-logo.png");
    expect(html.indexOf(MAIL_LOGO_URL)).toBeLessThan(html.indexOf("https://x/rapid-logo.png"));
    expect(html).toContain('alt="Rapid Insulation"');
    expect(html).not.toMatch(/src=""/);
    expect(html).toContain(`width="${OWN_COBRAND_LOGO_WIDTH}"`);
    // the rest of the email is untouched
    expect(html).toContain(">hi<");
    expect(html).toContain("VEU Accredited Person A003654");
  });
  test("partner alt and url are escaped", () => {
    const html = mjEmail({ ...base, partnerLogo: { url: "https://x/a.png?x=1&y=2", alt: 'Bob "The" <Insulator>' } });
    expect(html).toContain("&amp;y=2");
    expect(html).not.toContain("<Insulator>");
  });
});
