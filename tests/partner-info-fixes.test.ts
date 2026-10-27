// Partners review/list showed wrong facts (27 Oct 2026): rate flags read a column the signing RPC never fills,
// licence file/verified words were hard-coded, a missing/expired electrical licence did not block approval,
// and the full set-password link was printed on screen.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { partnerIssues, signedRecRates } from "../src/lib/partner.core";
import { buildPartnerProfile } from "../src/lib/partner-profile.core";
import { activationBlockers } from "../src/lib/partner-activation.core";
import { applicationChecks } from "../src/lib/office-partners.core";
import { recSignBlocker, type RecSignApp } from "../src/lib/rec-sign.core";
import { ACKNOWLEDGEMENTS, REC_AGREEMENT_VERSION, type RecData } from "../src/lib/rec-onboarding.core";

const recRow = { enquiry_type: "electrician_rec", phone: "0412345678", service_areas: ["Melbourne"], rec_registration_number: "REC 1", esv_licensed_electricians_confirmed: true, estimated_piesa_fee_inc_gst: null, estimated_return_visit_fee_inc_gst: null };

describe("1. PIESA / return visit flags read the signed rate card", () => {
  test("signed onboarding rates clear both flags even when the old enquiry columns are empty", () => {
    const issues = partnerIssues({ ...recRow, signed_rates: signedRecRates({ assessment_rate: 220, installation_attendance_rate: 220 }) });
    expect(issues).not.toContain("No indicative PIESA fee");
    expect(issues).not.toContain("No indicative return visit fee");
  });
  test("falls back to the old enquiry fields, and still flags when neither has a rate", () => {
    expect(partnerIssues({ ...recRow, estimated_piesa_fee_inc_gst: 300, estimated_return_visit_fee_inc_gst: 150 })).toEqual([]);
    expect(partnerIssues({ ...recRow, signed_rates: signedRecRates({}) })).toEqual(["No indicative PIESA fee", "No indicative return visit fee"]);
  });
  test("signedRecRates matches the profile card's Rates (inc GST)", () => {
    const data = { assessment_rate: "220", installation_attendance_rate: 220 };
    const p = buildPartnerProfile({ partner_type: "rec", signer_name: null, signer_position: null, signer_email: null, agreement_version: null, signed_at: null, agreement_text: null, insurance_certificate_path: null }, data);
    expect(signedRecRates(data)).toEqual({ piesa: p.rates.piesa, return_visit: p.rates.return_visit });
    expect(signedRecRates(null)).toEqual({ piesa: null, return_visit: null });
  });
  test("Partners list loads the fee columns and the signed rates before computing 'What they sent'", () => {
    const src = readFileSync("src/lib/office-partners.server.ts", "utf8");
    expect(src).toContain("estimated_piesa_fee_inc_gst, estimated_return_visit_fee_inc_gst");
    expect(src).toMatch(/partnerIssues\(\{ \.\.\.r, signed_rates: /);
  });
});

describe("2. licence file / verified words only when known", () => {
  const meta = { partner_type: "rec", signer_name: "Sam", signer_position: "Director", signer_email: "s@x.com", agreement_version: "v", signed_at: "2026-10-01", agreement_text: "t", insurance_certificate_path: null };
  const data = { rec_registration_number: "REC 1", licence_number: "A1", licence_expiry: "2030-01-01" };
  test("no upload or office check exists, so file/verified are unknown (null), never 'no'/'Not verified'", () => {
    for (const kind of ["rec_registration", "esv_licence"]) {
      const l = buildPartnerProfile(meta, data).licences.find((x) => x.kind === kind)!;
      expect(l.has_file).toBeNull();
      expect(l.verified).toBeNull();
    }
  });
  test("an office verification of the approved business's credential shows as Verified", () => {
    const p = buildPartnerProfile(meta, data, new Map(), [], { esv_licence: "verified", rec_registration: "pending" });
    expect(p.licences.find((x) => x.kind === "esv_licence")!.verified).toBe(true);
    expect(p.licences.find((x) => x.kind === "rec_registration")!.verified).toBeNull();
  });
  test("profile card omits unknown file/verified words", () => {
    const src = readFileSync("src/components/portal/partner-profile-card.tsx", "utf8");
    expect(src).toContain('l.has_file == null ? null : `file ${l.has_file ? "yes" : "no"}`');
    expect(src).toContain('{l.verified == null ? null : <> · <b>{l.verified ? "Verified" : "Not verified"}</b></>}');
  });
});

describe("3. electrical licence blocks approval (Jo 27 Oct 2026)", () => {
  const ok = { public_liability_expiry: "2099-01-01", licence_number: "A123", licence_expiry: "2030-01-01" } as RecData;
  const now = new Date("2026-10-27T00:00:00Z");
  test("missing number, missing expiry or expired licence blocks a REC activation", () => {
    expect(activationBlockers("rec", ok, REC_AGREEMENT_VERSION, "2026-10-01", now)).toEqual([]);
    expect(activationBlockers("rec", { ...ok, licence_number: " " }, REC_AGREEMENT_VERSION, "2026-10-01", now)).toEqual(["Electrical licence number is missing."]);
    expect(activationBlockers("rec", { ...ok, licence_expiry: "" }, REC_AGREEMENT_VERSION, "2026-10-01", now)).toEqual(["Electrical licence expiry is missing."]);
    expect(activationBlockers("rec", { ...ok, licence_expiry: "2026-10-26" }, REC_AGREEMENT_VERSION, "2026-10-01", now)).toEqual(["Electrical licence expired on 2026-10-26."]);
  });
  test("installer applications are not affected", () => {
    expect(activationBlockers("installer", { public_liability_expiry: "2099-01-01" } as never, "HI-VIC-A48-INST-1.13-2026-10-03", "2026-10-03", now)).toEqual([]);
  });
  test("approval checklist line splits missing vs expired", () => {
    const base = { type: "rec" as const, signedAt: "2026-10-01", signerName: "Sam", agreementVersion: "v", hasCertificate: true, verifiedCiiEmails: [], today: "2026-10-27" };
    const line = (d: Record<string, unknown>) => applicationChecks({ ...base, data: { ...ok, ...d } as never }).find((c) => c.text.startsWith("Electrical licence"))!;
    expect(line({ licence_number: "" })).toEqual({ mark: "missing", text: "Electrical licence number not given" });
    expect(line({ licence_expiry: "" })).toEqual({ mark: "missing", text: "Electrical licence expiry not given" });
    expect(line({ licence_expiry: "2026-10-26" })).toEqual({ mark: "missing", text: "Electrical licence expired 2026-10-26" });
    expect(line({}).mark).not.toBe("missing");
  });
  test("server refuses REC signing without a current licence expiry, even in relaxed test mode", () => {
    const acks = Object.fromEntries(ACKNOWLEDGEMENTS.map((a) => [a.key, true]));
    const input = { signer_name: "Sam Smith", signer_position: "Director", signer_email: "sam@spark.com.au", acknowledgements: acks, agreement_version: REC_AGREEMENT_VERSION, expected_updated_at: "x", agreement_sha256: "a".repeat(64) };
    const d = { works_under_rec: false, contact_is_licensed_electrician: true, licence_number: "A123" } as RecData;
    const app = (data: RecData): RecSignApp => ({ id: "a", status: "draft", data, insurance_certificate_path: "p", created_at: "x", updated_at: "x", test_mode: true, allow_incomplete_sign: true });
    expect(recSignBlocker(app({ ...d }), input, now)).toBe("Please enter your electrical licence expiry date before signing.");
    expect(recSignBlocker(app({ ...d, licence_expiry: "2026-10-01" }), input, now)).toBe("Your electrical licence has expired. Enter the new expiry date before signing.");
  });
});

describe("4. set-password link is never printed on screen", () => {
  test("PartnerLogin shows 'Link ready · Copy link', not the URL", () => {
    const src = readFileSync("src/components/portal/partner-application.tsx", "utf8");
    const login = src.slice(src.indexOf("export function PartnerLogin"), src.indexOf("export function OfficeEmailBox"));
    expect(login).not.toContain("value={link}");
    expect(login).not.toMatch(/>\{link\}</);
    expect(login).toContain("Link ready");
    expect(login).toContain("navigator.clipboard.writeText(link)");
  });
});
