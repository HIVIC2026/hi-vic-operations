import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import { PARTNER_TEMPLATES, REC_TEMPLATE, renderPartnerTemplate } from "../src/lib/partner-templates";

const canonical = readFileSync(new URL("../src/lib/templates/rec-partnership-invitation.html", import.meta.url), "utf8");

describe("REC partnership invitation", () => {
  test("metadata and catalogue entry", () => {
    expect(REC_TEMPLATE.label).toBe("REC partnership invitation");
    expect(REC_TEMPLATE.subject).toBe("Hundreds of homeowner enquiries—and we’re looking for great electricians");
    expect(PARTNER_TEMPLATES.map((t) => t.key)).toEqual(["rec_invitation", "installer_invitation"]);
  });
  test("stored and rendered HTML are byte-identical to the canonical file", () => {
    expect(REC_TEMPLATE.html).toBe(canonical);
    expect(renderPartnerTemplate(REC_TEMPLATE, "")).toBe(canonical);
    expect(createHash("sha256").update(canonical).digest("hex")).toBe("5ddda20dcf3c672d92279550c36aa6a00ec899532074e23de5eadaed8a4a193b");
  });
  test("clean CTA, embedded 400x171 logo", () => {
    const hrefs = [...canonical.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toContain("https://estimate.homeinsulationvictoria.com.au/electrician-onboarding");
    expect(hrefs.every((h) => !/[?#]/.test(h))).toBe(true);
    const b64 = canonical.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)![1];
    expect(b64.endsWith("AAAAAElFTkSuQmCC")).toBe(true);
    const png = Buffer.from(b64, "base64");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([400, 171]);
  });
});
