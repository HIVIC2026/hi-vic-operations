import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { PARTNER_TEMPLATES, REC_TEMPLATE, renderPartnerTemplate } from "../src/lib/partner-templates";

const canonical = readFileSync(new URL("../src/lib/templates/rec-partnership-invitation.html", import.meta.url), "utf8").replace(/\n$/, "");

describe("REC partnership invitation", () => {
  test("metadata and catalogue entry", () => {
    expect(REC_TEMPLATE.label).toBe("REC partnership invitation");
    expect(REC_TEMPLATE.subject).toBe("We provide the approved jobs. You bring the electrical expertise.");
    expect(PARTNER_TEMPLATES.map((t) => t.key)).toEqual(["rec_invitation", "installer_invitation"]);
  });
  test("stored and rendered HTML are byte-identical to the canonical file", () => {
    expect(REC_TEMPLATE.html).toBe(canonical);
    expect(renderPartnerTemplate(REC_TEMPLATE)).toBe(canonical);
    expect(createHash("sha256").update(canonical).digest("hex")).toBe("059819220e31b6aa382171d1bce68e81b43dd7926622e6f3472f56fb0dbd584f");
  });
  test("headline is the approved message; hundreds only in supporting copy", () => {
    expect(canonical).toContain("<title>We provide the approved jobs. You bring the electrical expertise.</title>");
    expect(canonical).toContain("We provide the<br>approved jobs.");
    expect(canonical).toContain("You bring the<br>electrical expertise.");
    expect(canonical).toContain("With hundreds of homeowner enquiries,");
    expect(canonical).not.toContain("Hundreds of<br>homeowner enquiries");
  });
  test("clean CTA and public HTTPS logo", () => {
    const hrefs = [...canonical.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toContain("https://estimate.homeinsulationvictoria.com.au/electrician-onboarding");
    expect(hrefs.every((h) => !/[?#]/.test(h))).toBe(true);
    expect(canonical).toContain('src="https://www.homeinsulationvictoria.com.au/home-insulation-victoria-logo.png"');
    expect(canonical).not.toContain("data:image/png;base64,");
  });
});
