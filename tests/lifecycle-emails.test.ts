// P1-R2-S02 — Later-stage customer lifecycle email renderers (pure).
// Covers the five S01B templates that the template catalog already registers but previously
// had no sample renderer: measured_quote · booking_consent · pre_install_pack ·
// assignment_signing · completion_pack.
//
// These renderers FOLLOW THE EXISTING pattern (estimate-email.ts / coverage-email.ts): a pure
// function returning { subject, previewText, html, plainText }. They NEVER send, recalculate a
// price, touch the database or invent legal wording. This file verifies, with no DB and no
// network:
//   1. correct renderer per template key (hub selection) + catalog label wiring,
//   3. correct variable substitution (figures/dates/addresses passed through, not computed),
//   6. consent / opt-out: unsubscribe link present in every office preview,
//   7. missing-data handling: optional name/address degrade to a safe default, never "undefined",
//   9. secure links are rendered verbatim,
//   + safe-hold: unresolved legal/business wording stays a visible [PLACEHOLDER] (never invented),
//   + no delivery: the renderer module imports/contains no send/DB/network code.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  renderMeasuredQuoteEmail,
  renderBookingConsentEmail,
  renderPreInstallPackEmail,
  renderAssignmentSigningEmail,
  renderCompletionPackEmail,
} from "../src/lib/lifecycle-emails";
import { samples, OUTCOME_LABELS } from "../src/lib/step3-email-samples";
import { CUSTOMER_COMMUNICATION_CATALOG } from "../src/lib/template-catalog";

const S02_KEYS = ["measured_quote", "booking_consent", "pre_install_pack", "assignment_signing", "completion_pack"] as const;

describe("P1-R2-S02 lifecycle email catalog wiring", () => {
  test("every S02 key is registered in the shared customer-communication catalog (reused, not a new system)", () => {
    for (const k of S02_KEYS) {
      expect(CUSTOMER_COMMUNICATION_CATALOG.some((c) => c[0] === k)).toBe(true);
    }
  });

  test("every S02 key has an office preview sample and a label", () => {
    for (const k of S02_KEYS) {
      const e = (samples as Record<string, { subject: string; html: string; plainText: string }>)[k];
      expect(typeof e?.subject).toBe("string");
      expect(e.html.length).toBeGreaterThan(800);
      expect(e.plainText.length).toBeGreaterThan(150);
      expect((OUTCOME_LABELS as Record<string, string>)[k]).toBeTruthy();
    }
  });

  test("office previews always carry an unsubscribe link (opt-out handling preserved)", () => {
    for (const k of S02_KEYS) {
      const e = (samples as Record<string, { html: string }>)[k];
      expect(/unsubscribe/i.test(e.html)).toBe(true);
    }
  });
});

describe("P1-R2-S02 measured quote renderer", () => {
  const out = renderMeasuredQuoteEmail({
    firstName: "Alex", address: "30 Dash St", measuredAreaM2: 150,
    piesaFee: "$349.00", supplyInstall: "$4,500.00", apFee: "$349.00",
    veecCount: 21, veuDiscount: "$1,481.76", totalIncGst: "$3,716.24",
    acceptUrl: "https://estimate.example/quote/secure-xyz", reference: "REF-1",
  });

  test("passes the validated figures through verbatim (no recomputation in the template)", () => {
    for (const v of ["150", "$349.00", "$4,500.00", "$1,481.76", "$3,716.24", "21"]) {
      expect(out.plainText).toContain(v);
    }
  });

  test("renders the secure acceptance link verbatim", () => {
    expect(out.html).toContain("https://estimate.example/quote/secure-xyz");
    expect(out.plainText).toContain("https://estimate.example/quote/secure-xyz");
  });

  test("holds the unresolved refund/cancellation wording as a visible placeholder (not invented)", () => {
    expect(out.plainText).toContain("[PLACEHOLDER");
    expect(out.plainText.toLowerCase()).toContain("refund");
  });

  test("the >15% area-change note appears only when the validated record flags it", () => {
    const withNote = renderMeasuredQuoteEmail({
      measuredAreaM2: 200, piesaFee: "$349.00", supplyInstall: "$6,000.00", apFee: "$349.00",
      veecCount: 28, veuDiscount: "$1,975.68", totalIncGst: "$4,722.32",
      acceptUrl: "https://x/y", areaChangedOver15pct: true,
    });
    expect(withNote.plainText.toLowerCase()).toContain("different from the earlier estimate");
    expect(out.plainText.toLowerCase()).not.toContain("different from the earlier estimate");
  });
});

describe("P1-R2-S02 booking confirmation + consent renderer", () => {
  const paid = renderBookingConsentEmail({
    firstName: "Alex", address: "30 Dash St", installDate: "Tue 20 Oct 2026", installTime: "8am-12pm",
    installerBusiness: "Sample Co", paidInFull: true,
    bookingUrl: "https://estimate.example/booking/secure-abc", reference: "REF-2",
  });
  const half = renderBookingConsentEmail({
    installDate: "Tue 20 Oct 2026", firstHalfAmount: "$1,858.12",
    bookingUrl: "https://estimate.example/booking/secure-abc",
  });

  test("shows the confirmed install date/time and installer", () => {
    expect(paid.plainText).toContain("Tue 20 Oct 2026");
    expect(paid.plainText).toContain("8am-12pm");
    expect(paid.plainText).toContain("Sample Co");
  });

  test("never claims a payment was received: paid-in-full vs 50% deposit wording only", () => {
    expect(paid.plainText.toLowerCase()).toContain("pay in full");
    expect(paid.plainText).not.toMatch(/payment (has been |)received/i);
    expect(half.plainText).toContain("$1,858.12");
    expect(half.plainText.toLowerCase()).toContain("first 50%");
  });

  test("holds the owner-consent wording as a visible placeholder (no fabricated legal consent)", () => {
    expect(paid.plainText).toContain("[PLACEHOLDER");
    expect(paid.plainText.toLowerCase()).toContain("consent");
  });
});

describe("P1-R2-S02 pre-install pack renderer", () => {
  const out = renderPreInstallPackEmail({
    installDate: "Tue 20 Oct 2026",
    documentsUrl: "https://estimate.example/documents/secure-def", reference: "REF-3",
  });

  test("references the PIESA document and the secure document link", () => {
    expect(out.plainText).toContain("PIESA");
    expect(out.html).toContain("https://estimate.example/documents/secure-def");
  });

  test("missing name/address degrade to a safe default (never the string 'undefined')", () => {
    expect(out.subject).not.toContain("undefined");
    expect(out.plainText).not.toContain("undefined");
    expect(out.plainText).toContain("your property");
  });
});

describe("P1-R2-S02 VEEC assignment signing renderer (post-install only)", () => {
  const out = renderAssignmentSigningEmail({
    firstName: "Alex", address: "30 Dash St",
    signingUrl: "https://estimate.example/sign/secure-ghi", reference: "REF-4",
  });

  test("refers to installation as already completed (never asks to pre-declare install facts)", () => {
    expect(out.plainText.toLowerCase()).toContain("has been installed");
  });

  test("renders the secure signing link verbatim", () => {
    expect(out.html).toContain("https://estimate.example/sign/secure-ghi");
  });

  test("holds the declaration wording / signing order as a visible placeholder (not invented)", () => {
    expect(out.plainText).toContain("[PLACEHOLDER");
    expect(out.plainText.toLowerCase()).toContain("declaration");
  });
});

describe("P1-R2-S02 completion pack renderer", () => {
  const withCoes = renderCompletionPackEmail({
    firstName: "Alex", address: "30 Dash St", coesIncluded: true,
    completionUrl: "https://estimate.example/completion/secure-jkl", reference: "REF-5",
  });
  const noCoes = renderCompletionPackEmail({
    coesIncluded: false, completionUrl: "https://estimate.example/completion/secure-jkl",
  });

  test("lists the required completion documents", () => {
    for (const d of ["Invoice", "VEEC assignment", "Warranty", "Dispute-resolution"]) {
      expect(withCoes.plainText).toContain(d);
    }
  });

  test("Certificate of Electrical Safety appears only when applicable", () => {
    expect(withCoes.plainText).toContain("Certificate of Electrical Safety");
    expect(noCoes.plainText).not.toContain("Certificate of Electrical Safety");
  });

  test("holds the required AP contact detail as a visible placeholder (not invented)", () => {
    expect(withCoes.plainText).toContain("[PLACEHOLDER");
  });

  test("does not claim registry finalisation", () => {
    expect(withCoes.plainText.toLowerCase()).not.toContain("registry");
  });
});

describe("P1-R2-S02 no delivery engine / no DB in the renderer module", () => {
  // Reuses the existing renderer theme only; must not import a send/delivery/db/network path.
  const src = readFileSync(new URL("../src/lib/lifecycle-emails.ts", import.meta.url), "utf8");
  test("imports only the shared estimate-email theme (no new delivery/database engine)", () => {
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports).toEqual(["./estimate-email"]);
  });
  test("contains no send / fetch / supabase / insert call", () => {
    expect(/\b(fetch|supabase|\.insert\(|sendEmail|deliver)\b/i.test(src)).toBe(false);
  });
});
