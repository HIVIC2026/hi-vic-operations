// Preliminary email-based Save My Spot – pure rules (synthetic examples only, no real records).
// Anna-style: mid-1970s home, unsafe stair hatch, unknown size/type/life support.
// Victor-style: owner described "synthetic fluff", no safe photos, declared 100 m².
import { describe, expect, test } from "bun:test";
import {
  PRELIMINARY_BUTTON, PRELIMINARY_INTRO, PRELIMINARY_NEXT_STEP, PRELIMINARY_READY_CHECK,
  assertNoPricingContent, preliminaryConsentKey, preliminaryConsentSnapshot, preliminaryReviewMetadata,
  preliminarySendBlocker, renderPreliminarySaveSpotEmail, renderPreliminarySpotSavedEmail,
} from "../src/lib/preliminary-save-spot.core";
import { SPOT_SAVED_BODY, SPOT_SAVED_HEADING } from "../src/lib/save-spot-offer.core";
import { intakeJobFacts } from "../src/lib/enquiry.server";
import { enquirySchema } from "../src/lib/enquiry.server";

const SAVE_URL = "https://estimate.homeinsulationvictoria.com.au/save-spot-preliminary/token-abc";

describe("preliminary invitation rendering (Jo's approved short copy)", () => {
  const mail = renderPreliminarySaveSpotEmail({ firstName: "Anna", saveUrl: SAVE_URL, unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=abcdefghijklmnopqrst" });
  test("subject is the approved first-name form", () => {
    expect(mail.subject).toBe("Anna, save your spot");
  });
  test("exact approved wording is present", () => {
    for (const line of [PRELIMINARY_INTRO, PRELIMINARY_NEXT_STEP, PRELIMINARY_READY_CHECK, PRELIMINARY_BUTTON, "Thanks,", "Jo", "Home Insulation Victoria"]) {
      expect(mail.plainText).toContain(line);
    }
    for (const frag of ["No worries at all", "Save my spot", "free Ready Check", "no payment or obligation"]) {
      expect(mail.html).toContain(frag);
    }
  });
  test("no price, area, rebate or '$0' anywhere (Anna-style: unknown everything)", () => {
    const all = mail.html + mail.plainText + mail.subject;
    expect(all).not.toContain("$");
    expect(all).not.toMatch(/rebate/i);
    expect(all).not.toMatch(/m²|\bm2\b/);
    expect(all).not.toMatch(/\d+\s*m/);
  });
  test("falls back to a plain greeting when no first name (Victor-style)", () => {
    const v = renderPreliminarySaveSpotEmail({ firstName: null, saveUrl: SAVE_URL, unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=abcdefghijklmnopqrst" });
    expect(v.subject).toBe("There, save your spot");
    expect(v.html).toContain("Hi there,");
  });
  test("guard rejects priced content", () => {
    expect(() => assertNoPricingContent("Your $0 rebate is waiting")).toThrow();
    expect(() => assertNoPricingContent("Installation $3,300 inc GST")).toThrow();
    expect(() => assertNoPricingContent("about 110 m²")).toThrow();
    expect(() => assertNoPricingContent(PRELIMINARY_READY_CHECK)).not.toThrow();
  });
});

describe("rebate-free saved confirmation", () => {
  const mail = renderPreliminarySpotSavedEmail({ firstName: "Victor", myJobUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/tok" });
  test("approved wording, no rebate and no made-up figures", () => {
    expect(mail.text).toContain(SPOT_SAVED_HEADING);
    expect(mail.text).toContain(SPOT_SAVED_BODY);
    expect(mail.text).not.toContain("$");
    expect(mail.text).not.toMatch(/rebate is waiting/i);
    expect(mail.subject).toBe("Your spot is saved");
  });
});

describe("preliminarySendBlocker (re-read facts, preview vs send)", () => {
  const base = { source: "base44", channel: "hivic_sourced", stage: "preliminary_estimate_ready", ownerEmail: "a@example.com", spotSaved: false, optedOut: false, latestReviewId: "r1", shownReviewId: null, mode: "preview" as const, realOn: false };
  test("preview allowed without review match; send requires the previewed review", () => {
    expect(preliminarySendBlocker(base)).toBeNull();
    expect(preliminarySendBlocker({ ...base, mode: "send" })).toContain("Preview this invitation");
    expect(preliminarySendBlocker({ ...base, mode: "send", shownReviewId: "r1", realOn: true })).toBeNull();
    expect(preliminarySendBlocker({ ...base, mode: "send", shownReviewId: "r0", realOn: true })).toContain("Preview this invitation");
  });
  test("portal-source manual enquiries are allowed; other sources are not", () => {
    expect(preliminarySendBlocker({ ...base, source: "portal" })).toBeNull();
    expect(preliminarySendBlocker({ ...base, source: "qa_test" })).toContain("website or manual");
    expect(preliminarySendBlocker({ ...base, source: "installer_sourced" })).toContain("website or manual");
  });
  test("closed stages, missing email, missing review, saved spot, opt-out, switch off", () => {
    expect(preliminarySendBlocker({ ...base, stage: "cancelled" })).toContain("moved on");
    expect(preliminarySendBlocker({ ...base, stage: "installation_booked" })).toContain("moved on");
    expect(preliminarySendBlocker({ ...base, ownerEmail: "  " })).toBe("No owner email.");
    expect(preliminarySendBlocker({ ...base, latestReviewId: null })).toContain("Record the owner-email preliminary review");
    expect(preliminarySendBlocker({ ...base, spotSaved: true })).toBe("Spot already saved.");
    expect(preliminarySendBlocker({ ...base, optedOut: true })).toBe("Owner opted out.");
    expect(preliminarySendBlocker({ ...base, mode: "send", shownReviewId: "r1" })).toContain("switched off");
  });
});

describe("review + consent binding facts", () => {
  test("review metadata is explicitly not a photo/media review", () => {
    const m = preliminaryReviewMetadata({ reason: "unsafe stair hatch; loose fill described", communicationId: "c1", emailAt: "2026-10-21T09:00:00Z", reviewer: "u1" });
    expect(m.photoReview).toBe(false);
    expect(m.mediaReviewed).toBe(false);
    expect(m.kind).toBe("preliminary_email_review");
    expect(m.communication_id).toBe("c1");
  });
  test("consent snapshot records individual reply permission bound to the inbound email", () => {
    const s = preliminaryConsentSnapshot({ communicationId: "c1", recordedBy: "u1", recordedAt: "2026-10-22T00:00:00Z" });
    expect(s.basis).toBe("owner_contact_form_requested_reply");
    expect(s.purpose).toBe("individual_reply");
    expect(s.communication_id).toBe("c1");
    expect(s.recorded_by).toBe("u1");
    // Deterministic binding: same communication → same key, so re-recording is a duplicate no-op.
    expect(preliminaryConsentKey("c1")).toBe(preliminaryConsentKey("c1"));
    expect(preliminaryConsentKey("c1")).toBe("email-reply:c1");
  });
});

describe("manual intake unknown facts (intakeJobFacts)", () => {
  const hivic = { channel: "hivic_sourced" as const };
  test("portal manual may record unknown area and unknown life support (Anna-style)", () => {
    const f = intakeJobFacts({ estimated_area_m2: null, area_unknown: true, life_support: null, life_support_status: "unknown" }, "portal", hivic);
    expect(f.estimated_area_m2).toBeNull();
    expect(f.estimated_area_unknown).toBe(true);
    // jobs.life_support stays the legacy boolean projection; 'unknown' is carried by life_support_status.
    expect(f.life_support).toBe(false);
    expect(f.life_support_status).toBe("unknown");
  });
  test("portal manual with a real area keeps the signed-intake facts (Victor-style)", () => {
    const f = intakeJobFacts({ estimated_area_m2: 100, area_unknown: false, life_support: false, life_support_status: "no" }, "portal", hivic);
    expect(f.estimated_area_m2).toBe(100);
    expect(f.estimated_area_unknown).toBe(false);
    expect(f.life_support).toBe(false);
  });
  test("base44 keeps the locked numeric-area invariant and never an unknown flag", () => {
    expect(() => intakeJobFacts({ estimated_area_m2: null, area_unknown: true }, "base44", hivic)).toThrow("estimated_area_m2 is required");
    expect(() => intakeJobFacts({ estimated_area_m2: 150, area_unknown: true }, "base44", hivic)).toThrow("Only manual portal intake");
    expect(() => intakeJobFacts({ estimated_area_m2: null, area_unknown: true }, "qa_test", hivic)).toThrow("estimated_area_m2 is required");
  });
  test("base44 life support still defaults to a recorded false, never null", () => {
    const f = intakeJobFacts({ estimated_area_m2: 150 }, "base44", hivic);
    expect(f.life_support).toBe(false);
    expect(f.life_support_status).toBeNull();
  });
  test("installer origin may still register with no measure-up", () => {
    const f = intakeJobFacts({ estimated_area_m2: null }, "portal", { channel: "installer_sourced", businessId: "b", userId: "u" });
    expect(f.estimated_area_m2).toBeNull();
  });
  test("schema accepts null area only as an explicit value (manual form), rejects missing", () => {
    const ok = enquirySchema.safeParse({ full_name: "Anna", email: "a@example.com", address_line: "1 Test St", estimated_area_m2: null, area_unknown: true, life_support_status: "unknown" });
    expect(ok.success).toBe(true);
    const missing = enquirySchema.safeParse({ full_name: "Anna", email: "a@example.com", address_line: "1 Test St" });
    expect(missing.success).toBe(false);
  });
});
