// Preliminary email-based Save My Spot – pure rules (synthetic examples only, no real records).
// Anna-style: mid-1970s home, unsafe stair hatch, unknown size/type/life support.
// Victor-style: owner described "synthetic fluff", no safe photos, declared 100 m².
import { describe, expect, test } from "bun:test";
import {
  preliminaryConsentKey, preliminaryConsentSnapshot, preliminaryReviewMetadata,
  preliminarySendBlocker, preliminarySavedEstimateSnapshot,
} from "../src/lib/preliminary-save-spot.core";
import { intakeJobFacts } from "../src/lib/enquiry.server";
import { enquirySchema } from "../src/lib/enquiry.server";


describe("preliminary save uses the normal priced snapshot", () => {
  test("entered area, price and rebate are preserved", () => {
    const snapshot = preliminarySavedEstimateSnapshot({ id: "estimate-100", area_m2: 100, insulation_declared: "unknown", scenarios: [{ by_access: { standard: { estimated_customer_total: 2598, applied_discount: 1400, pre_discount_total: 3998 } } }] }, "tok");
    expect(snapshot).toEqual({ saved_estimate_id: "estimate-100", saved_total: 2598, saved_veu_discount: 1400, saved_gross_total: 3998, saved_area_m2: 100, saved_insulation: "unknown", saved_estimate_url: "/estimate/tok/calculator" });
  });
  test("missing estimate never becomes fabricated prices or area", () => {
    expect(() => preliminarySavedEstimateSnapshot(null, "tok")).toThrow("Your estimate is not ready");
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
