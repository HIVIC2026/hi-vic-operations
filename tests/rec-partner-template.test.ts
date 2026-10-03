import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { PARTNER_TEMPLATES, REC_TEMPLATE, renderPartnerTemplate } from "../src/lib/partner-templates";

const canonical = readFileSync(new URL("../src/lib/templates/rec-partnership-invitation.html", import.meta.url), "utf8").replace(/\n$/, "");

describe("REC partnership invitation", () => {
  test("metadata and catalogue entry", () => {
    expect(REC_TEMPLATE.label).toBe("REC partnership invitation");
    expect(REC_TEMPLATE.subject).toBe("Hundreds of homeowner enquiries—and we’re looking for great electricians");
    expect(PARTNER_TEMPLATES.map((t) => t.key)).toEqual(["rec_invitation", "installer_invitation"]);
  });
  test("stored and rendered HTML are byte-identical to the canonical file", () => {
    expect(REC_TEMPLATE.html).toBe(canonical);
    expect(renderPartnerTemplate(REC_TEMPLATE)).toBe(canonical);
    expect(createHash("sha256").update(canonical).digest("hex")).toBe("6c694b151f94766eb3562583337d488b05ebcd6c46a1bee48934b58578eaf381");
  });
  test("original headline and intro restored, with only the two approved wording replacements", () => {
    expect(canonical).toContain("<title>Hundreds of enquiries. Join our electrical network.</title>");
    expect(canonical).toContain("Hundreds of<br>homeowner enquiries.");
    expect(canonical).toContain("Let’s work together.");
    expect(canonical).toContain("We’re expanding our electrical network across Victoria—and we’d love your business to be part of it.");
    // Approved replacement 1
    expect(canonical).toContain("We provide the approved jobs, coordinate the insulation upgrade and manage the rebate process as the Accredited Person. <strong style=\"color:#22376B;\">You bring the electrical expertise.</strong>");
    expect(canonical).not.toContain("We bring in homeowner enquiries");
    // Approved replacement 2
    expect(canonical).toContain("Sharper rates help us turn more enquiries into approved jobs");
    expect(canonical).not.toContain("Sharper rates help more homeowners proceed");
    // Removed unsolicited sentence must stay out
    expect(canonical).not.toContain("Any rectification is quoted and approved before it proceeds.");
  });
  test("clean CTA and embedded approved logo", () => {
    const hrefs = [...canonical.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toContain("https://estimate.homeinsulationvictoria.com.au/electrician-onboarding");
    expect(hrefs.every((h) => !/[?#]/.test(h))).toBe(true);
    expect(canonical).toContain('src="data:image/png;base64,');
  });
});
