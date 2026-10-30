import { describe, expect, it } from "bun:test";
import { INSTALLER_GAP, installerCandidate, installerEligibilityBlocker, installerGapReason, type InstallerFacts } from "../src/lib/readycheck-booking.core";

const today = "2026-10-27";
const fullCert = { status: "verified", level: "full", expiresOn: "2028-10-27" };
const ok = { noticeAcknowledged: true, cert: fullCert };
const facts: InstallerFacts = {
  business_id: "b", name: "TEST Bravo", is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true,
  coverage_verified: true, covers_postcode: true, exact_postcode: true, credentialsOk: true, fullCertifiedInstallers: 0, freeMeasureUps: true,
  weekly_capacity: null, open_jobs: 0, recent_offers_30d: 0, acceptance_rate: null, free_in_window: null,
};

describe("Choose installer: each 'Can't be offered' reason is the true one", () => {
  it("ESC notice not accepted names the notice and the installer (TEST Bravo case)", () => {
    const gap = installerGapReason([{ ...ok, noticeAcknowledged: false }], today);
    expect(gap).toBe(INSTALLER_GAP.notice);
    expect(installerEligibilityBlocker(installerCandidate({ ...facts, installerGap: gap }))).toBe("The installer hasn't accepted the ESC privacy notice yet. The installer must open their notice link and accept it.");
  });
  it("no certification", () => expect(installerGapReason([{ ...ok, cert: null }], today)).toBe(INSTALLER_GAP.noCert));
  it("certification not verified", () => expect(installerGapReason([{ ...ok, cert: { ...fullCert, status: "pending" } }], today)).toBe(INSTALLER_GAP.certNotVerified));
  it("not Full", () => expect(installerGapReason([{ ...ok, cert: { ...fullCert, level: "provisional" } }], today)).toBe(INSTALLER_GAP.notFull));
  it("expired", () => expect(installerGapReason([{ ...ok, cert: { ...fullCert, expiresOn: "2026-10-26" } }], today)).toBe(INSTALLER_GAP.expired));
  it("no installer person", () => expect(installerGapReason([], today)).toBe(INSTALLER_GAP.none));
  it("one person offerable = no gap", () => expect(installerGapReason([{ ...ok, cert: null }, ok], today)).toBeNull());
  it("document reason is the real document blocker", () => {
    expect(installerEligibilityBlocker(installerCandidate({ ...facts, fullCertifiedInstallers: 1, credentialsOk: false, credentialsGap: "Public liability insurance expired." }))).toBe("Public liability insurance expired.");
  });
  it("business not approved and free Ready Checks each say who acts", () => {
    expect(installerEligibilityBlocker(installerCandidate({ ...facts, onboarding_status: "pending" }))).toContain("The office must approve it");
    expect(installerEligibilityBlocker(installerCandidate({ ...facts, fullCertifiedInstallers: 1, freeMeasureUps: false }))).toContain("The installer must agree");
  });
});
