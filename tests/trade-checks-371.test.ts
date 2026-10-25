// Decision 371 (Jo, 25 Oct 2026): trade checks — expiry watch + block, number format checks, ESV register lookup stub.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { expiredBusinessDocsBlocker, latestCiiExpiryByWorker, tradeExpiryRows, type ExpiryCredential } from "../src/lib/trade-expiry.core";
import { LICENCE_FORMAT_MESSAGE, REC_FORMAT_MESSAGE, licenceNumberProblem, recNumberProblem } from "../src/lib/trade-numbers.core";
import { notChecked, registerCheckLine, registerQueries, shouldRecordLookup, switchOn } from "../src/lib/esv-register.core";
import { applicationChecks, missingItemsMessage } from "../src/lib/office-partners.core";
import { stepErrors, type RecData } from "../src/lib/rec-onboarding.core";

const today = "2026-10-25";
const businesses = [{ id: "b1", name: "Spark Pty Ltd", active: true }, { id: "b2", name: "Old Co", active: false }, { id: "b3", name: "Roof Pros", active: true }];
const cred = (c: Partial<ExpiryCredential>): ExpiryCredential => ({ businessId: "b1", profileId: null, kind: "public_liability_insurance", label: "Public liability", expiresAt: null, ...c });

describe("371(a) expiry watch: ONE Needs me row per document from 30 days before", () => {
  test("latest date per document wins (a renewal supersedes the lapsed row); nothing outside 30 days", () => {
    const rows = tradeExpiryRows({ today, businesses, people: [], credentials: [
      cred({ expiresAt: "2026-10-01" }), cred({ expiresAt: "2027-10-01" }), // renewed → no row
      cred({ kind: "rec_registration", label: "REC number", expiresAt: "2026-11-10" }), // 16 days → row
      cred({ kind: "rec_registration", label: "REC number", expiresAt: "2026-11-10" }), // duplicate upload → still ONE row
      cred({ kind: "workers_comp_insurance", label: "Workers comp", expiresAt: "2026-12-30" }), // 66 days → none
    ] });
    expect(rows.map((r) => [r.key, r.document, r.expired, r.daysLeft])).toEqual([["expiry:b1:rec_registration:business", "REC registration", false, 16]]);
    expect(rows[0]!.line).toContain("in 16 days");
  });

  test("expired documents come first and say no new offers; inactive businesses and removed people are skipped", () => {
    const rows = tradeExpiryRows({ today, businesses, credentials: [
      cred({ businessId: "b3", kind: "installer_certification", label: "EEC", expiresAt: "2026-10-20" }),
      cred({ businessId: "b2", expiresAt: "2026-10-01" }),
      cred({ businessId: "b3", kind: "other", label: "Public Liability Certificate of Currency", expiresAt: "2026-11-01" }), // label match = PL
    ], people: [
      { id: "w1", name: "Sam Smith", businessId: "b1", licenceExpiresOn: "2026-11-20" },
      { id: "w2", name: "Gone", businessId: "b1", removed: true, licenceExpiresOn: "2026-10-01" },
      { id: "w3", name: "Ina", businessId: "b3", ciiExpiresOn: "2026-10-24" },
    ] });
    expect(rows.map((r) => r.key)).toEqual(["expiry:b3:installer_certification:business", "expiry:person:w3:worker_cii", "expiry:b3:public_liability_insurance:business", "expiry:person:w1:worker_licence"]);
    expect(rows[0]!.line).toContain("no new offers");
    expect(rows[1]!.who).toBe("Ina (Roof Pros)");
    expect(rows[3]!.document).toBe("Electrical licence");
  });

  test("per-person credentials (an electrician's licence on the business) are one row per person", () => {
    const rows = tradeExpiryRows({ today, businesses, people: [], credentials: [
      cred({ kind: "electrical_licence", label: "Licence", profileId: "p1", expiresAt: "2026-11-01" }),
      cred({ kind: "electrical_licence", label: "Licence", profileId: "p2", expiresAt: "2026-11-02" }),
    ] });
    expect(rows.map((r) => r.key)).toEqual(["expiry:b1:electrical_licence:p1", "expiry:b1:electrical_licence:p2"]);
  });

  test("blocker: lapsed PL / installer certificate / REC registration stops new offers; renewal or no date doesn't", () => {
    const v = (kind: string, expires: string | null, label = kind) => ({ kind, label, expires, verified: true });
    expect(expiredBusinessDocsBlocker([v("public_liability_insurance", "2026-10-01")], today)).toContain("Public liability insurance expired on 2026-10-01");
    expect(expiredBusinessDocsBlocker([v("public_liability_insurance", "2026-10-01"), v("public_liability_insurance", "2027-10-01")], today)).toBeNull();
    expect(expiredBusinessDocsBlocker([v("rec_registration", "2026-10-24")], today)).toContain("REC registration expired");
    expect(expiredBusinessDocsBlocker([v("rec_registration", "2026-10-24")], today, ["public_liability_insurance", "installer_certification"])).toBeNull();
    expect(expiredBusinessDocsBlocker([v("installer_certification", null)], today)).toBeNull();
    expect(expiredBusinessDocsBlocker([v("installer_certification", "2026-10-25")], today)).toBeNull(); // expires today = still current
  });

  test("CII: the latest check for the person, then its latest recorded level", () => {
    const m = latestCiiExpiryByWorker([{ id: "w1", email: "A@x.com" }, { id: "w2", email: "b@x.com" }],
      [{ id: "c1", worker_id: null, worker_email: "a@x.com", recorded_at: "2026-01-01" }, { id: "c2", worker_id: "w1", worker_email: "a@x.com", recorded_at: "2026-06-01" }],
      [{ certification_id: "c1", expires_on: "2030-01-01", recorded_at: "2026-01-02" }, { certification_id: "c2", expires_on: "2026-11-01", recorded_at: "2026-06-02" }, { certification_id: "c2", expires_on: "2026-12-01", recorded_at: "2026-07-01" }]);
    expect([...m.entries()]).toEqual([["w1", "2026-12-01"]]);
  });

  test("wiring: offers check the new blocker; office rows come from the pure rule", () => {
    expect(readFileSync(new URL("../src/lib/readycheck-booking.server.ts", import.meta.url), "utf8")).toContain('expiredBusinessDocsBlocker(');
    expect(readFileSync(new URL("../src/lib/allocation.server.ts", import.meta.url), "utf8")).toContain('["public_liability_insurance", "rec_registration"]');
    expect(readFileSync(new URL("../src/lib/office.server.ts", import.meta.url), "utf8")).toContain("tradeExpiryRows(");
  });
});

describe("371(b) number format checks at onboarding", () => {
  test("licence: optional class letter(s) + digits; spaces and dashes ignored", () => {
    for (const ok of ["A12345", "a 123456", "A-12345", "12345", "A123"]) expect(licenceNumberProblem(ok)).toBeNull();
    for (const bad of ["A1", "ABC12345", "licence", "A12345678", "12-AB"]) expect(licenceNumberProblem(bad)).toBe(LICENCE_FORMAT_MESSAGE);
    expect(licenceNumberProblem("")).toBeNull(); // "required" is its own rule
  });
  test("REC: optional REC prefix + 3–6 digits", () => {
    for (const ok of ["REC 12345", "rec-12345", "12345", "REC 999"]) expect(recNumberProblem(ok)).toBeNull();
    for (const bad of ["REC SAMPLE", "REC1", "1234567", "R12345"]) expect(recNumberProblem(bad)).toBe(REC_FORMAT_MESSAGE);
  });
  test("REC onboarding refuses a malformed licence or REC number", () => {
    const base: RecData = { works_under_rec: false, primary_contact_name: "Sam", contact_is_licensed_electrician: true, licence_number: "A12345", licence_expiry: "2030-01-01", business_phone: "0412345678", business_email: "sam@spark.com.au", legal_entity_name: "Spark Pty Ltd", abn: "51824753556", rec_registration_number: "REC 12345" };
    expect(stepErrors("about", base)).not.toContain(LICENCE_FORMAT_MESSAGE);
    expect(stepErrors("about", { ...base, licence_number: "SAMPLE" })).toContain(LICENCE_FORMAT_MESSAGE);
    expect(stepErrors("business", base)).not.toContain(REC_FORMAT_MESSAGE);
    expect(stepErrors("business", { ...base, rec_registration_number: "REC SAMPLE" })).toContain(REC_FORMAT_MESSAGE);
    expect(stepErrors("business", { ...base, works_under_rec: true, host_rec_name: "Host", host_rec_number: "abc" })).toContain(REC_FORMAT_MESSAGE);
  });
});

describe("371(c) ESV register lookup: stub records 'not checked', office still approves", () => {
  test("the queries come from the application; host REC for staff", () => {
    expect(registerQueries({ licence_number: "A12345", rec_registration_number: "REC 1", primary_contact_name: "Sam" })).toEqual([{ kind: "licence", number: "A12345", name: "Sam" }, { kind: "rec", number: "REC 1", name: null }]);
    expect(registerQueries({ works_under_rec: true, host_rec_number: "REC 9", rec_registration_number: "REC 1" }).map((q) => q.number)).toEqual(["REC 9"]);
  });
  test("switch defaults off; not-checked is a warning to check by hand, recorded once", () => {
    expect(switchOn({})).toBe(false);
    expect(switchOn({ ESV_REGISTER_LOOKUP_ENABLED: "true" })).toBe(true);
    const r = notChecked({ kind: "rec", number: "REC 12345" }, "register lookup switched off", "2026-10-25T00:00:00Z");
    expect(registerCheckLine(r)).toEqual({ mark: "warn", text: "ESV register · REC REC 12345 not checked automatically (register lookup switched off) — check it on the ESV website before approving" });
    expect(shouldRecordLookup(null, r)).toBe(true);
    expect(shouldRecordLookup({ status: "not_checked", detail: "register lookup switched off" }, r)).toBe(false);
    expect(registerCheckLine({ ...r, status: "not_found", detail: "" }).mark).toBe("missing");
    expect(registerCheckLine({ ...r, status: "found_current", detail: "", expiresOn: "2027-01-01" }).mark).toBe("ok");
  });
  test("review page shows the lookup and format lines; the applicant email never asks for them", () => {
    const checks = applicationChecks({ type: "rec", data: { abn: "51824753556", rec_registration_number: "REC SAMPLE", licence_number: "A12345", licence_expiry: "2030-01-01", assessment_rate: 300 }, signedAt: "2026-10-20T00:00:00Z", signerName: "Sam", agreementVersion: "v", hasCertificate: true, verifiedCiiEmails: [], today,
      registerLookups: [notChecked({ kind: "licence", number: "A12345" }, "no register adapter configured", "2026-10-25T00:00:00Z")] });
    expect(checks.find((c) => c.text.startsWith("REC REC SAMPLE"))?.mark).toBe("warn");
    expect(checks.find((c) => c.text.startsWith("ESV register"))?.mark).toBe("warn");
    expect(missingItemsMessage(checks)).not.toContain("ESV register");
    expect(missingItemsMessage(checks)).toContain("number format looks wrong");
  });
  test("no live adapter is configured (the sandbox can't reach esv.vic.gov.au); lookups never approve or block", () => {
    const src = readFileSync(new URL("../src/lib/esv-register.server.ts", import.meta.url), "utf8");
    expect(src).toMatch(/configuredEsvRegisterAdapter\(\): EsvRegisterAdapter \| null \{\n\s+return null;/);
    expect(src).not.toMatch(/activatePartnerApplication|onboarding_status/);
  });
});
