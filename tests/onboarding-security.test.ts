import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  START_LIMITS, contactDraftAllowed, fingerprintSource, hasForbiddenFlag, isOwnQuarantinePath, mayRelaxRequiredSteps,
  normaliseEmail, normaliseMobile, safeOriginalName, startAllowed, verifyInsuranceBytes, INSURANCE_MAX_BYTES,
} from "../src/lib/onboarding-security.core";

const enc = (s: string) => new TextEncoder().encode(s);
const cat = (...p: Uint8Array[]) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const PDF = enc("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");
const PNG = cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), enc("IHDR"), new Uint8Array(17), new Uint8Array([0, 0, 0, 0]), enc("IEND"), new Uint8Array([0xae, 0x42, 0x60, 0x82]));
const JPG = cat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array(40), new Uint8Array([0xff, 0xd9]));

describe("start limits", () => {
  const now = 1_000_000_000_000;
  test("3 per 15 minutes, 5 per 24 hours, rolling", () => {
    expect(startAllowed([], now)).toBe(true);
    expect(startAllowed([now - 1000, now - 2000], now)).toBe(true);
    expect(startAllowed([now - 1000, now - 2000, now - 3000], now)).toBe(false);
    expect(startAllowed([now - 16 * 60_000, now - 17 * 60_000, now - 18 * 60_000], now)).toBe(true);
    expect(startAllowed([1, 2, 3, 4, 5].map((h) => now - h * 3_600_000), now)).toBe(false);
    expect(startAllowed([1, 2, 3, 4, 5].map((h) => now - (h + 20) * 3_600_000), now)).toBe(true);
  });
  test("contact cap: third draft for same contact refused", () => {
    expect(START_LIMITS.activeDraftsPerContactAndTrade).toBe(2);
    expect(contactDraftAllowed(0)).toBe(true);
    expect(contactDraftAllowed(1)).toBe(true);
    expect(contactDraftAllowed(2)).toBe(false);
  });
  test("shared office IP: different devices get different fingerprints", () => {
    expect(fingerprintSource("1.2.3.4", "Safari iPhone", "rec")).not.toBe(fingerprintSource("1.2.3.4", "Chrome Windows", "rec"));
    expect(fingerprintSource("1.2.3.4", "Safari", "rec")).not.toBe(fingerprintSource("1.2.3.4", "Safari", "installer"));
  });
  test("normalisation", () => {
    expect(normaliseEmail(" Jo@Example.COM ")).toBe("jo@example.com");
    expect(normaliseEmail("nope")).toBeNull();
    expect(normaliseMobile("+61 412 345 678")).toBe("0412345678");
    expect(normaliseMobile("0412-345-678")).toBe("0412345678");
    expect(normaliseMobile("03 9000 0000")).toBeNull();
  });
});

describe("test mode trust", () => {
  test("public flags are recognised as forbidden", () => {
    for (const k of ["test", "test_mode", "sample", "preview", "qa", "is_test"]) expect(hasForbiddenFlag({ [k]: true })).toBe(true);
    expect(hasForbiddenFlag({ token: "x" })).toBe(false);
  });
  test("required steps only relax for an explicit QA permission", () => {
    expect(mayRelaxRequiredSteps({ test_mode: false, allow_incomplete_sign: true })).toBe(false);
    expect(mayRelaxRequiredSteps({ test_mode: true, allow_incomplete_sign: false })).toBe(false);
    expect(mayRelaxRequiredSteps({ test_mode: true, allow_incomplete_sign: null })).toBe(false);
    expect(mayRelaxRequiredSteps({ test_mode: true, allow_incomplete_sign: true })).toBe(true);
  });
  test("start inputs are strict and no server boundary reads a public test flag", () => {
    for (const f of ["src/lib/rec-onboarding.functions.ts", "src/lib/installer-onboarding.functions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toContain("data.test");
      expect(src).not.toContain("app.test_mode ? null");
      expect(src).toMatch(/staff_link: tokenSchema\.optional\(\) \}\)\.strict\(\)/);
    }
    const rec = readFileSync("src/lib/rec-onboarding.functions.ts", "utf8");
    expect(rec).toContain('blockedMandatoryStep("sign", d) ?? (relax ? null : firstIncompleteStep(d))');
  });
  test("pages never send a test switch", () => {
    for (const f of ["src/routes/electrician-onboarding.tsx", "src/routes/installer-onboarding.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/get\("test"\)/);
      expect(src).not.toMatch(/\{ test: /);
    }
  });
  test("test applications are excluded from staff queues and approval", () => {
    for (const f of ["src/lib/coverage.functions.ts", "src/lib/todo.functions.ts", "src/lib/admin-records.functions.ts"]) {
      expect(readFileSync(f, "utf8")).toContain("portal_rec_onboarding_test,portal_installer_onboarding_test");
    }
    expect(readFileSync("src/lib/todo.functions.ts", "utf8")).toContain('.eq("status", "submitted").eq("test_mode", false)');
    expect(readFileSync("src/lib/partner-activation.functions.ts", "utf8")).toContain("Test applications can never be approved");
  });
});

describe("insurance file verification", () => {
  test("valid PDF, PNG and JPEG", () => {
    expect(verifyInsuranceBytes(PDF, "application/pdf")).toEqual({ ok: true, type: "pdf" });
    expect(verifyInsuranceBytes(PNG, "image/png")).toEqual({ ok: true, type: "png" });
    expect(verifyInsuranceBytes(JPG, "image/jpeg")).toEqual({ ok: true, type: "jpg" });
  });
  test("fake PDF containing other bytes", () => expect(verifyInsuranceBytes(enc("MZ\x90\x00 not a pdf"), "application/pdf").ok).toBe(false));
  test("claimed type mismatch", () => expect(verifyInsuranceBytes(JPG, "application/pdf").ok).toBe(false));
  test("oversized", () => expect(verifyInsuranceBytes(cat(PDF, new Uint8Array(INSURANCE_MAX_BYTES))).ok).toBe(false));
  test("truncated / corrupt", () => {
    expect(verifyInsuranceBytes(PDF.subarray(0, 20), "application/pdf").ok).toBe(false);
    expect(verifyInsuranceBytes(PNG.subarray(0, 30), "image/png").ok).toBe(false);
    expect(verifyInsuranceBytes(JPG.subarray(0, 20), "image/jpeg").ok).toBe(false);
    expect(verifyInsuranceBytes(new Uint8Array(0), null).ok).toBe(false);
  });
  test("active PDF and polyglot HTML refused", () => {
    expect(verifyInsuranceBytes(enc("%PDF-1.4\n<</OpenAction<</S/JavaScript/JS(app.alert(1))>>>>\n%%EOF"), "application/pdf").ok).toBe(false);
    expect(verifyInsuranceBytes(cat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), enc("<script>alert(1)</script>"), new Uint8Array([0xff, 0xd9])), "image/jpeg").ok).toBe(false);
  });
  test("filenames: double extension and traversal refused", () => {
    expect(safeOriginalName("certificate.pdf")).toBe(true);
    expect(safeOriginalName("photo.JPEG")).toBe(true);
    expect(safeOriginalName("cert.pdf.exe")).toBe(false);
    expect(safeOriginalName("cert.exe.pdf")).toBe(false);
    expect(safeOriginalName("../../etc/passwd.pdf")).toBe(false);
    expect(safeOriginalName("a\\b.pdf")).toBe(false);
    expect(safeOriginalName("noextension")).toBe(false);
  });
  test("only this application's own quarantine slot is accepted", () => {
    const id = "11111111-1111-1111-1111-111111111111"; const u = "22222222-2222-2222-2222-222222222222";
    expect(isOwnQuarantinePath(`quarantine/rec-onboarding/${id}/${u}`, "rec-onboarding", id)).toBe(true);
    expect(isOwnQuarantinePath(`quarantine/rec-onboarding/${id}/../x/${u}`, "rec-onboarding", id)).toBe(false);
    expect(isOwnQuarantinePath(`quarantine/rec-onboarding/other/${u}`, "rec-onboarding", id)).toBe(false);
    expect(isOwnQuarantinePath(`rec-onboarding/${id}/insurance-${u}.pdf`, "rec-onboarding", id)).toBe(false);
  });
});
