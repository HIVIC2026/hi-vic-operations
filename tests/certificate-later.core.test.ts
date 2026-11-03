// Part 3 Task 3 (Jo 3 Nov 2026): "Waiting for certificate" — the pure state, the status lines, the link's certificate checks.
import { describe, expect, test } from "bun:test";
import {
  CERTIFICATE_ADD_LINK_TEXT_APPROVED, CERTIFICATE_UPLOAD_MAX_BYTES, UPGRADES_DAY_NOT_SET_LINE, certificateAddLinkText, certificateProblem, certificateState, certificateStatusLine,
  certificateUploadPath, parseCertificateUploadPath, upgradesDayProblem, waitingForCertificateLine,
} from "../src/lib/certificate-later.core";
import { mergeCertificateIntoPiesaSnapshot } from "../src/lib/fixes-day.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { A3_REPAIR_NEEDED_LABEL, SHORT_PIESA_FIELDS, shortAnswersFromEntries } from "../src/lib/official-short.core";
import { OWNER_UPGRADES_BOOKED_APPROVED, bookingNotice } from "../src/lib/in-house-booking.core";

const base = { upgradesNeeded: true, upgradesDoneAt: "2026-11-03", partCRecorded: true, certificateFileAt: null as string | null, certificateTicked: false };

describe("certificateState", () => {
  test.each([
    [{ ...base, upgradesNeeded: false, partCRecorded: false, upgradesDoneAt: null }, "none_needed"],
    [{ ...base, partCRecorded: false, upgradesDoneAt: null }, "upgrades_pending"],
    // Review Focus 4: same-day upgrades on the A3 with no certificate → Part C recorded, job "Waiting for certificate".
    [{ ...base }, "waiting_for_certificate"],
    // Task 2 concern 3: a number typed without a file is still "waiting" — the state keys on the FILE.
    [{ ...base, certificateFileAt: null, certificateTicked: false }, "waiting_for_certificate"],
    [{ ...base, certificateFileAt: "2026-11-05T01:00:00Z" }, "certificate_in"],
    [{ ...base, certificateFileAt: "2026-11-05T01:00:00Z", certificateTicked: true }, "clear"],
    // A ticked flag with no file never counts (fail closed).
    [{ ...base, certificateFileAt: null, certificateTicked: true }, "waiting_for_certificate"],
  ] as const)("%o → %s", (f, want) => expect(certificateState(f)).toBe(want));
});

describe("status lines (installer + office job pages)", () => {
  test("waiting for the certificate names the electrician", () => {
    expect(waitingForCertificateLine("Sparky Sam")).toBe("Waiting for Sparky Sam's Certificate of Electrical Safety");
    expect(waitingForCertificateLine(null)).toBe("Waiting for the electrician's Certificate of Electrical Safety");
    expect(certificateStatusLine({ state: "waiting_for_certificate", electrician: "Sparky Sam", upgradesDaySet: false })).toBe("Waiting for Sparky Sam's Certificate of Electrical Safety");
  });
  test("upgrades needed, not done, no day entered → 'Upgrades day not set yet'; day set → nothing extra", () => {
    expect(certificateStatusLine({ state: "upgrades_pending", electrician: null, upgradesDaySet: false })).toBe(UPGRADES_DAY_NOT_SET_LINE);
    expect(UPGRADES_DAY_NOT_SET_LINE).toBe("Upgrades day not set yet");
    expect(certificateStatusLine({ state: "upgrades_pending", electrician: null, upgradesDaySet: true })).toBeNull();
  });
  test("no line when nothing is needed, when the certificate is in, or when it is clear", () => {
    for (const state of ["none_needed", "certificate_in", "clear"] as const) expect(certificateStatusLine({ state, electrician: "X", upgradesDaySet: true })).toBeNull();
  });
  test("plain English: never 'fixes' or 'repair'", () => {
    for (const s of [waitingForCertificateLine("A"), UPGRADES_DAY_NOT_SET_LINE, certificateAddLinkText({ first: "Sam", address: "1 Example St", url: "https://x/e/t" })]) expect(s).not.toMatch(/fixes|repair/i);
  });
});

describe("the link's certificate step", () => {
  const today = "2026-11-04";
  test("number, date and file are all required; the date can't be in the future", () => {
    expect(certificateProblem({ number: "", date: "2026-11-03", hasFile: true, today })).toContain("number");
    expect(certificateProblem({ number: "C123", date: "", hasFile: true, today })).toContain("date");
    expect(certificateProblem({ number: "C123", date: "2026-13-40", hasFile: true, today })).toContain("date");
    expect(certificateProblem({ number: "C123", date: "2026-11-05", hasFile: true, today })).toContain("future");
    expect(certificateProblem({ number: "C123", date: "2026-11-04", hasFile: false, today })).toContain("photo or PDF");
    expect(certificateProblem({ number: " C123 ", date: "2026-11-04", hasFile: true, today })).toBeNull();
  });
  test("upload paths live under the job's electrician-uploads folder and parse back to their id", () => {
    const p = certificateUploadPath("job-1", "abc-1234-5678", "application/pdf");
    expect(p).toBe("jobs/job-1/electrician-uploads/abc-1234-5678.pdf");
    expect(parseCertificateUploadPath("job-1", p)).toBe("abc-1234-5678");
    expect(parseCertificateUploadPath("job-2", p)).toBeNull();
    expect(parseCertificateUploadPath("job-1", "jobs/job-1/other/abc.pdf")).toBeNull();
    expect(parseCertificateUploadPath("job-1", "jobs/job-1/electrician-uploads/../x.pdf")).toBeNull();
    expect(certificateUploadPath("j", "u", "image/jpeg")).toEndWith(".jpg");
    expect(CERTIFICATE_UPLOAD_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
  test("the upgrades day must be ahead of now", () => {
    const now = new Date("2026-11-04T01:00:00Z");
    expect(upgradesDayProblem("junk", now)).toContain("isn't valid");
    expect(upgradesDayProblem("2026-11-03T23:00:00Z", now)).toContain("already passed");
    expect(upgradesDayProblem("2026-11-10T23:00:00Z", now)).toBeNull();
  });
  test("the number and date land on the PIESA short answers (Part C) without touching anything else", () => {
    const label = (id: string) => SHORT_PIESA_FIELDS.find((f) => f.id === id)!.label;
    const snap = [{ label: A3_REPAIR_NEEDED_LABEL, value: "Yes" }, { label: label("coesNumber"), value: null }, { label: label("certDate"), value: null }];
    const out = mergeCertificateIntoPiesaSnapshot(snap, { number: "C123", date: "2026-11-04" });
    expect(out.find((e) => e.label === label("coesNumber"))?.value).toBe("C123");
    expect(out.find((e) => e.label === label("certDate"))?.value).toBe("2026-11-04");
    expect(shortAnswersFromEntries("piesa", out)).toMatchObject({ coesNumber: "C123", certDate: "2026-11-04" });
    expect(out[0]).toEqual(snap[0]);
    expect(snap[1]!.value).toBeNull(); // input untouched
    // Missing rows are added rather than dropped (an A3 built before Part C existed).
    const added = mergeCertificateIntoPiesaSnapshot([snap[0]!], { number: "C9", date: "2026-11-01" });
    expect(added.map((e) => e.value)).toEqual(["Yes", "C9", "2026-11-01"]);
  });
});

describe("held wording", () => {
  test("the certificate link text is held (not approved) and registered as a partner text with quiet hours", () => {
    expect(CERTIFICATE_ADD_LINK_TEXT_APPROVED).toBe(false);
    expect(SMS_MESSAGE_TYPES.electrician_certificate_link).toMatchObject({ audience: "partner", wordingApproved: false, quietHours: true });
    expect(SMS_FRESHNESS.electrician_certificate_link).toEqual({ kind: "window" });
    const t = certificateAddLinkText({ first: "Sam", address: "1 Example St, Clayton 3168", url: "https://portal.test/e/abc" });
    expect(t).toContain("Sam");
    expect(t).toContain("Certificate of Electrical Safety");
    expect(t).toContain("1 Example St, Clayton 3168");
    expect(t).toContain("https://portal.test/e/abc");
  });
  test("the owner's 'You're booked' for the upgrades day is held and says electrical upgrades", () => {
    expect(OWNER_UPGRADES_BOOKED_APPROVED).toBe(false);
    const n = bookingNotice({ kind: "upgrades", start: "2026-11-10T22:00:00Z", who: { name: "Sparky Sam", phone: "0411111111" }, installer: "Reinsulate", phone: "0300000000" });
    expect(n.subject).toContain("electrical upgrades");
    expect(n.text).toContain("electrical upgrades");
    expect(n.sms).toContain("electrical upgrades");
    expect(`${n.subject} ${n.text} ${n.sms}`).not.toMatch(/fixes|repair/i);
  });
});
