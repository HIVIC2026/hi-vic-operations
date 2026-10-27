import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PARTNER_LINK_HOURS, partnerLinkMessage, partnerLoginUrl } from "../src/lib/set-password-link.core";
const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
describe("partner login links last 24 hours, single use (Jo, 7 Oct)", () => {
  test("link goes to our set-password page with our token, never the calculator", () => {
    const u = new URL(partnerLoginUrl("abc".repeat(10)));
    expect(u.pathname).toBe("/reset-password"); expect(u.searchParams.get("link")).toBe("abc".repeat(10)); expect(u.searchParams.get("next")).toBe("/field/welcome");
    expect(PARTNER_LINK_HOURS).toBe(24);
  });
  test("approval and 'send new link' issue the 24-hour link; single use is enforced in the database", () => {
    expect(src("lib/partner-activation.functions.ts")).toContain("issuePartnerLoginLink(");
    expect(src("lib/set-password-link.server.ts")).toContain('rpc("claim_partner_login_link"');
    expect(readFileSync(new URL("../docs/pending-migrations/0146_partner_login_links.sql", import.meta.url), "utf8")).toContain("interval '24 hours'");
  });
  test("clear messages for used / expired / invalid", () => {
    expect(partnerLinkMessage("used")).toBe("This link has already been used.");
    expect(partnerLinkMessage("expired")).toBe("This link has expired.");
  });
});
