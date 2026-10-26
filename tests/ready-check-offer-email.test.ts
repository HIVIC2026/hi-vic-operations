import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { READY_CHECK_OFFER_EMAIL_APPROVED, readyCheckOfferSubject, renderReadyCheckOfferEmail } from "../src/lib/ready-check-offer-email.core";
import { readyCheckOfferText } from "../src/lib/ready-check-times.core";

describe("our-lead job offer email alongside the offer text (Jo 24 Oct 2026, decision 106)", () => {
  test("switched on for real partners (decision 154); delivery still goes through the guarded office partner sender", () => { expect(READY_CHECK_OFFER_EMAIL_APPROVED).toBe(true); });
  test("subject names the suburb; body has the same facts as the text (ceiling size in a box) plus the offer button; no owner details or prices", () => {
    const url = "https://estimate.homeinsulationvictoria.com.au/field/offer/abc";
    const m = renderReadyCheckOfferEmail({ installerFirstName: "Deep", suburb: "Carlton", offerUrl: url, areaM2: 140 });
    expect(m.subject).toBe("New Ready Check job near Carlton");
    expect(readyCheckOfferSubject(null)).toBe("New Ready Check job near you");
    expect(m.text).toContain("Hi Deep,");
    expect(readyCheckOfferText("Carlton", url, 140)).toContain("(about 140 m²)");
    expect(m.text).toContain("New Ready Check job near Carlton");
    expect(m.text).toContain("Ceiling size: about 140 m²");
    expect(m.html).toContain(">about 140 m²<");
    expect(m.text).toContain("To take it, offer the owner 3 times within 24 hours.");
    expect(m.text).toContain(`See the offer: ${url}`);
    expect(renderReadyCheckOfferEmail({ installerFirstName: null, suburb: null, offerUrl: url }).html).not.toContain("Ceiling size");
    expect(m.html).toContain("See the offer");
    expect(m.html).toContain(url);
    expect(m.text).not.toMatch(/\$\d/);
  });
  test("wired into the EXISTING office-pick offer path, after the text; one email per offer; TEST via sendTestEmail; real through the guarded sender", () => {
    const pick = readFileSync(new URL("../src/lib/ready-check-times.server.ts", import.meta.url), "utf8");
    expect(pick.indexOf("textInstallerAboutOffer(row.id)")).toBeGreaterThan(0);
    expect(pick.indexOf("emailInstallerAboutOffer(row.id)")).toBeGreaterThan(pick.indexOf("textInstallerAboutOffer(row.id)"));
    const src = readFileSync(new URL("../src/lib/ready-check-offer-text.server.ts", import.meta.url), "utf8");
    expect(src).toContain("export async function emailInstallerAboutOffer");
    expect(src).toContain('job.channel === "installer_sourced") return "skipped"');
    expect(src).toContain('contains("details", { offer_id: o.id })');
    expect(src).toContain("sendTestEmail(");
    expect(src).toContain("else if (!READY_CHECK_OFFER_EMAIL_APPROVED)");
    expect(src).not.toMatch(/sendRealSms\([^)]*job_offer_email/); // email never becomes a second text
  });
});
