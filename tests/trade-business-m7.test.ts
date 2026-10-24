// My business (approved installer mock-up M7, decision 204): pure derivations behind every row, the NEXT panel and
// the public liability expiry block (compliance checklist H3). No I/O.
import { describe, expect, test } from "bun:test";
import { agreementLine, bankLine, businessNext, detailsLine, insuranceRowSub, latestExpiry, noticeLine, ratesLine, teamCiiLine, teamFactsLine, usualElectricianLine, TEAM_RULE } from "../src/lib/trade-view.core";
import { publicLiabilityBlocker } from "../src/lib/worker-compliance.core";
import { prestartFailures, type PrestartFacts } from "../src/lib/prestart.core";
import { installerCandidate, installerEligibilityBlocker } from "../src/lib/readycheck-booking.core";

const TODAY = "2026-10-24";

describe("team rows (decisions 153, 161, 130)", () => {
  test("facts line shows mobile, Mitti login and privacy notice from recorded facts only", () => {
    expect(teamFactsLine({ mobile: "0412 000 111", mittiLogin: "linked", noticeAcknowledged: true })).toBe("0412 000 111 · Mitti login ✓ · Privacy notice ✓");
    expect(teamFactsLine({ mobile: "0455 444 555", mittiLogin: "not_set", noticeAcknowledged: false })).toBe("0455 444 555 · Mitti login not set · Privacy notice outstanding");
    expect(teamFactsLine({ mobile: null, mittiLogin: "email_changed", noticeAcknowledged: null })).toBe("No mobile on file · Mitti login to re-check");
  });
  test("CII line is derived by crewClearance: cleared with expiry, otherwise the reason and 'not on installs yet'", () => {
    expect(teamCiiLine({ certStatus: "verified", level: "full", expiresOn: "2027-03-14" }, TODAY)).toEqual({ text: "CII cleared · expires 14 Mar 2027", tone: "green" });
    expect(teamCiiLine({ certStatus: null, level: null, expiresOn: null }, TODAY)).toEqual({ text: "CII being checked · not on installs yet", tone: "rose" });
    expect(teamCiiLine({ certStatus: "verified", level: null, expiresOn: null }, TODAY)?.text).toBe("CII being checked · not on installs yet");
    expect(teamCiiLine({ certStatus: "verified", level: "full", expiresOn: "2026-10-01" }, TODAY)).toEqual({ text: "CII expired · not on installs yet", tone: "rose" });
    expect(teamCiiLine({ certStatus: "rejected", level: null, expiresOn: null }, TODAY)?.text).toBe("CII not accepted · not on installs yet");
    expect(teamCiiLine(null, TODAY)).toBeNull();
    expect(TEAM_RULE).toBe("Ready Checks can go to anyone listed here. Install days only to CII-cleared people who've acknowledged the privacy notice.");
  });
});

describe("business file rows", () => {
  const creds = [
    { kind: "public_liability_insurance", label: "Public liability", expires: "2026-04-01", verified: true },
    { kind: "public_liability_insurance", label: "Public liability", expires: "2026-11-11", verified: false },
    { kind: "workers_comp_insurance", label: "Workers comp", expires: "2027-06-30", verified: true },
  ];
  test("latest expiry wins (a renewal upload supersedes the old date)", () => {
    expect(latestExpiry(creds, "public_liability_insurance")).toBe("2026-11-11");
    expect(latestExpiry([], "public_liability_insurance")).toBeNull();
    expect(latestExpiry([{ kind: "other", label: "Public Liability Certificate", expires: "2027-01-01T00:00:00Z", verified: false }], "public_liability_insurance")).toBe("2027-01-01");
  });
  test("insurance row", () => {
    expect(insuranceRowSub(creds, TODAY)).toEqual({ text: "Public liability expires Wed 11 Nov · Workers comp current", warn: true });
    expect(insuranceRowSub([{ kind: "public_liability_insurance", label: "Public liability", expires: "2027-11-11", verified: true }], TODAY)).toEqual({ text: "Public liability current", warn: false });
    expect(insuranceRowSub([], TODAY)).toEqual({ text: "Public liability not on file", warn: true });
    expect(insuranceRowSub([{ kind: "public_liability_insurance", label: "Public liability", expires: "2026-10-01", verified: true }], TODAY).text).toBe("Public liability expired Thu 1 Oct");
  });
  test("bank line never shows the full numbers", () => {
    expect(bankLine({ account_name: "Reinsulate Pty Ltd", bsb: "063-123", account_number: "12344471" })).toBe("Reinsulate Pty Ltd · BSB 063-xxx · account ending 4471");
    expect(bankLine(null)).toBe("Add where we pay you");
    expect(bankLine({ account_name: "X", bsb: "063123", account_number: "12344471" })).not.toContain("12344471");
  });
  test("agreement, rates, usual electrician, details, notice", () => {
    expect(agreementLine({ version: "1.16", signer: "Deep Singh", signedAt: "2026-10-02T23:00:00Z" })).toBe("v1.16 · signed by Deep Singh, 3 Oct 2026 · View PDF");
    expect(agreementLine(null)).toBe("Not signed yet · the office will send it");
    expect(ratesLine("2026-10-03", true)).toBe("Agreed 3 Oct 2026 · Request a change");
    expect(ratesLine(null, false)).toBe("Being confirmed with the office");
    expect(usualElectricianLine({ name: "Sam Lee", licence: "28841", priceIncGst: 280 })).toBe("Sam Lee · REC 28841 · $280 inc GST per safety check");
    expect(usualElectricianLine({ name: "Sam Lee", licence: "28841", priceIncGst: 280.5 })).toContain("$280.50");
    expect(usualElectricianLine(null)).toBe("Not set · add them so we can use them on your jobs");
    expect(detailsLine({ legal: "Reinsulate Pty Ltd", name: "Reinsulate", abn: "61 123 456 789", baseSuburb: "Clyde North", allVictoria: false })).toBe("Reinsulate Pty Ltd · ABN 61 123 456 789 · Clyde North");
    expect(noticeLine([{ name: "Deep Singh", state: "acknowledged" }, { name: "Tom Brown", state: "pending" }])).toEqual({ text: "1 to acknowledge · Tom Brown", outstanding: 1 });
    expect(noticeLine([{ name: "Deep Singh", state: "acknowledged" }]).text).toBe("Acknowledged");
    expect(noticeLine([]).text).toBe("Read the notice");
  });
});

describe("NEXT panel is derived, one thing at a time", () => {
  const ok = { installer: true, publicLiabilityExpires: "2027-06-30", bankSaved: true, agreementSigned: true, noticeOutstanding: [], usualElectrician: true, ciiBlocked: [] };
  test("public liability inside 30 days wins over everything", () => {
    const n = businessNext({ ...ok, publicLiabilityExpires: "2026-11-11", bankSaved: false, noticeOutstanding: [{ name: "Tom Brown" }] }, TODAY);
    expect(n).toEqual({ title: "Your public liability insurance runs out in 18 days", sub: "Expires Wed 11 Nov. Upload the renewed certificate so offers keep coming.", button: "Upload renewed insurance", to: "/field/business/insurance" });
    expect(businessNext({ ...ok, publicLiabilityExpires: "2026-10-01" }, TODAY)?.title).toBe("Your public liability insurance has expired");
    expect(businessNext({ ...ok, publicLiabilityExpires: null }, TODAY)?.button).toBe("Upload insurance");
    expect(businessNext({ ...ok, publicLiabilityExpires: "2026-11-24" }, TODAY)).toBeNull();
  });
  test("otherwise the next real outstanding item, in order; nothing outstanding = no panel", () => {
    expect(businessNext({ ...ok, bankSaved: false, noticeOutstanding: [{ name: "Tom Brown" }] }, TODAY)?.to).toBe("/field/business/bank");
    expect(businessNext({ ...ok, noticeOutstanding: [{ name: "Tom Brown" }] }, TODAY)?.title).toBe("Tom Brown still has to acknowledge the ESC privacy notice");
    expect(businessNext({ ...ok, noticeOutstanding: [{ name: "A" }, { name: "B" }] }, TODAY)?.title).toBe("2 people still have to acknowledge the ESC privacy notice");
    expect(businessNext({ ...ok, usualElectrician: false }, TODAY)?.to).toBe("/field/business/electrician");
    expect(businessNext({ ...ok, installer: false, usualElectrician: false }, TODAY)).toBeNull();
    expect(businessNext({ ...ok, ciiBlocked: [{ name: "Tom Brown" }] }, TODAY)?.title).toBe("Tom Brown isn't cleared for installs yet");
    expect(businessNext({ ...ok, agreementSigned: false }, TODAY)?.to).toBe("/field/business/agreement");
    expect(businessNext(ok, TODAY)).toBeNull();
  });
});

describe("public liability expiry blocks offers and pre-start like the CII (H3)", () => {
  test("blocker only once lapsed; no date on file is not a block", () => {
    expect(publicLiabilityBlocker("2026-10-23", TODAY)).toBe("Public liability insurance expired on 2026-10-23. Upload the renewed certificate under My business.");
    expect(publicLiabilityBlocker("2026-10-24", TODAY)).toBeNull();
    expect(publicLiabilityBlocker(null, TODAY)).toBeNull();
  });
  test("pre-start fails with the insurance line; older callers without the fact are unchanged", () => {
    const base: PrestartFacts = {
      start: "2026-10-30T22:00:00Z", clearance: { cleared: true, blocker: null }, deadline: "2026-11-20",
      esc: { status: "sent", sent_at: "2026-10-27T00:00:00Z", submission_reference: "REF", scheduled_start: "2026-10-30T22:00:00Z" } as never,
      lead: { found: true, status: "verified", level: "full", expiresOn: "2027-01-01", name: "Deep", noticeAcknowledged: true },
      consentBlockers: [], piesaCompletedAt: "2026-10-20T00:00:00Z",
    };
    expect(prestartFailures(base)).toEqual([]);
    expect(prestartFailures({ ...base, publicLiabilityBlocker: publicLiabilityBlocker("2026-10-01", TODAY) })).toEqual(["Installer business: Public liability insurance expired on 2026-10-01. Upload the renewed certificate under My business."]);
  });
  test("Ready Check installer pick: lapsed documents make the business ineligible", () => {
    const facts = { business_id: "b", name: "Reinsulate", is_active: true, onboarding_status: "approved", accepting_new_jobs: true, receives_hivic_leads: true, coverage_verified: true, covers_postcode: true, exact_postcode: true, fullCertifiedInstallers: 1, freeMeasureUps: true, weekly_capacity: null, open_jobs: 0, recent_offers_30d: 0, acceptance_rate: null };
    expect(installerEligibilityBlocker(installerCandidate({ ...facts, credentialsOk: true }))).toBeNull();
    expect(installerEligibilityBlocker(installerCandidate({ ...facts, credentialsOk: false }))).toBe("A required document has expired.");
    expect(installerEligibilityBlocker(installerCandidate({ ...facts, credentialsOk: true, accepting_new_jobs: false }))).toContain("not accepting new jobs");
  });
});
