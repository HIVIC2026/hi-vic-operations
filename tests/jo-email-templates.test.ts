// P1-R3-COM-08 — Jo Lowe's eight email templates: routing, CTA, wording, review gate,
// saved-pricing immutability, and safety. Pure unit tests (bun:test), no network/DB/sends.
import { describe, expect, test } from "bun:test";
import {
  selectJoTemplate,
  ctasForTemplate,
  subjectForTemplate,
  renderJoEstimateEmail,
  renderJoIneligibleEmail,
  renderJoReadyCheckInvitation,
  DEFAULT_ASSUMED_AREA_M2,
  type JoRoutingInput,
  type JoEstimateFigures,
  type JoRecipient,
  type SavedPricingSnapshot,
} from "../src/lib/jo-email-templates.core";

const recipient: JoRecipient = {
  firstName: "Alex",
  propertyAddress: "12 Example St, Melbourne VIC 3000",
  enquiryReference: "JOB-1001",
};

const liveFigures = (overrides: Partial<JoEstimateFigures> = {}): JoEstimateFigures => ({
  veuRebate: 1200,
  customerTotal: 3800,
  totalBeforeRebate: 5000,
  installation: 4200,
  piesaFee: 349,
  apFee: 451,
  ceilingAreaM2: 150,
  areaEstimated: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. Routing — all eight distinct branches
// ---------------------------------------------------------------------------
describe("selectJoTemplate routing", () => {
  const base: JoRoutingInput = { outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false };

  test("T1 eligible / no insulation / size unknown", () => {
    expect(selectJoTemplate({ ...base, insulation: "none", ceilingSizeKnown: false }))
      .toBe("eligible_no_insulation_size_unknown");
  });
  test("T2 eligible / no insulation / size known", () => {
    expect(selectJoTemplate({ ...base, insulation: "none", ceilingSizeKnown: true }))
      .toBe("eligible_no_insulation_size_known");
  });
  test("T3 below R2 reviewed / size unknown", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: false, deskCheckStatus: "looks_eligible" }))
      .toBe("eligible_below_r2_reviewed_size_unknown");
  });
  test("T4 below R2 reviewed / size known", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" }))
      .toBe("eligible_below_r2_reviewed_size_known");
  });
  test("T5 potentially eligible / unknown insulation / size unknown", () => {
    expect(selectJoTemplate({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false }))
      .toBe("potentially_eligible_unknown_size_unknown");
  });
  test("T6 potentially eligible / unknown insulation / size known", () => {
    expect(selectJoTemplate({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true }))
      .toBe("potentially_eligible_unknown_size_known");
  });
  test("T7 ineligible", () => {
    expect(selectJoTemplate({ outcome: "ineligible", insulation: null, ceilingSizeKnown: false }))
      .toBe("ineligible");
  });
  test("T8 ready check invitation with saved snapshot", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, readyCheckInvitation: true, savedSnapshotAvailable: true }))
      .toBe("ready_check_invitation");
  });
});

// ---------------------------------------------------------------------------
// 2. Below-R2 review gate — must NOT fire without a verified review
// ---------------------------------------------------------------------------
describe("below-R2 review gate", () => {
  test("present insulation WITHOUT review does NOT select below-R2 (falls to potentially-eligible upload)", () => {
    const id = selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: false, deskCheckStatus: null });
    expect(id).toBe("potentially_eligible_unknown_size_unknown");
  });
  test("unknown insulation is never treated as below R2", () => {
    const id = selectJoTemplate({ outcome: "likely_eligible", insulation: "unknown", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" });
    expect(id).toBe("potentially_eligible_unknown_size_known");
  });
  test("desk status not_eligible / needs_onsite_check does not unlock below-R2", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "needs_onsite_check" }))
      .toBe("potentially_eligible_unknown_size_known");
  });
});

// ---------------------------------------------------------------------------
// 3. Ready Check invitation — fail closed without snapshot (Group-B style restriction)
// ---------------------------------------------------------------------------
describe("ready check invitation safety", () => {
  test("no readable snapshot => null (fail closed, no public-calculator fallback)", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, readyCheckInvitation: true, savedSnapshotAvailable: false }))
      .toBeNull();
  });
  test("renderer throws if personal estimate link is missing", () => {
    const badSnap = { ...snapshot, personalEstimateUrl: "" } as SavedPricingSnapshot;
    expect(() => renderJoReadyCheckInvitation(recipient, badSnap)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. CTA mapping
// ---------------------------------------------------------------------------
describe("CTA selection", () => {
  test("eligible templates use Save my spot", () => {
    expect(ctasForTemplate("eligible_no_insulation_size_unknown")).toEqual(["save_my_spot"]);
    expect(ctasForTemplate("eligible_below_r2_reviewed_size_known")).toEqual(["save_my_spot"]);
  });
  test("potentially eligible templates use upload, NOT save my spot", () => {
    expect(ctasForTemplate("potentially_eligible_unknown_size_unknown")).toEqual(["upload_media"]);
    expect(ctasForTemplate("potentially_eligible_unknown_size_known")).not.toContain("save_my_spot");
  });
  test("ineligible has no Save my spot", () => {
    expect(ctasForTemplate("ineligible")).toEqual(["review_result"]);
    expect(ctasForTemplate("ineligible")).not.toContain("save_my_spot");
  });
  test("ready check invitation uses Book my Ready Check", () => {
    expect(ctasForTemplate("ready_check_invitation")).toEqual(["book_ready_check"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Known vs unknown ceiling area wording + default 150 m²
// ---------------------------------------------------------------------------
describe("ceiling area wording", () => {
  test("unknown size => 150 m² estimated, not measured", () => {
    const out = renderJoEstimateEmail("eligible_no_insulation_size_unknown", recipient, liveFigures({ ceilingAreaM2: DEFAULT_ASSUMED_AREA_M2, areaEstimated: true }));
    expect(out.body).toContain("150 m² — estimated, not measured");
    expect(out.body).toContain("we’ve used 150 m² for this preliminary quote");
  });
  test("known size => based on the size you provided", () => {
    const out = renderJoEstimateEmail("eligible_no_insulation_size_known", recipient, liveFigures({ ceilingAreaM2: 220, areaEstimated: false }));
    expect(out.body).toContain("220 m² — based on the size you provided");
    expect(out.body).not.toContain("estimated, not measured");
  });
});

// ---------------------------------------------------------------------------
// 6. Removal allowance wording — informational; NOT added to the quoted total
// ---------------------------------------------------------------------------
describe("removal allowance", () => {
  test("below-R2 templates include $15/m² allowance wording", () => {
    const out = renderJoEstimateEmail("eligible_below_r2_reviewed_size_unknown", recipient, liveFigures());
    expect(out.body).toContain("$15 per m² including GST for the areas that need removal only");
    expect(out.body).toContain("Removal is not included in this preliminary quote");
  });
  test("removal allowance is not silently added to customer total", () => {
    const f = liveFigures({ customerTotal: 3800 });
    const out = renderJoEstimateEmail("eligible_below_r2_reviewed_size_known", recipient, { ...f, areaEstimated: false, ceilingAreaM2: 180 });
    // The displayed total equals the input total; no removal math applied to it.
    expect(out.body).toContain("Your estimated cost after rebate: $3,800 including GST");
  });
  test("eligible-no-insulation templates exclude removal (no $15 budget line)", () => {
    const out = renderJoEstimateEmail("eligible_no_insulation_size_known", recipient, liveFigures({ areaEstimated: false, ceilingAreaM2: 200 }));
    expect(out.body).toContain("Insulation removal and electrical fixes are excluded");
    expect(out.body).not.toContain("budget $15 per m²");
  });
});

// ---------------------------------------------------------------------------
// 7. Saved pricing immutability (Template 8)
// ---------------------------------------------------------------------------
const snapshot: SavedPricingSnapshot = Object.freeze({
  veuRebate: 1100,
  customerTotal: 3600,
  totalBeforeRebate: 4700,
  installation: 4000,
  piesaFee: 349,
  apFee: 451,
  ceilingAreaM2: 150,
  areaEstimated: true,
  savedAt: "2026-10-01T00:00:00.000Z",
  personalEstimateUrl: "https://estimate.homeinsulationvictoria.com.au/e/TOKEN123",
});

describe("ready check invitation uses saved snapshot immutably", () => {
  test("renders SAVED figures, not current rates", () => {
    const out = renderJoReadyCheckInvitation(recipient, snapshot);
    expect(out.body).toContain("Your estimated cost after rebate: $3,600 including GST");
    expect(out.body).toContain("Before rebate: $4,700 including GST");
    expect(out.body).toContain("You could save $1,100");
  });
  test("calculator button links to the PERSONAL estimate URL (no public calculator)", () => {
    const out = renderJoReadyCheckInvitation(recipient, snapshot);
    expect(out.body).toContain(snapshot.personalEstimateUrl);
  });
  test("pricing changes after save do not affect a snapshot object", () => {
    // Simulate 'current rates' changing: snapshot is frozen and rendering reads only the snapshot.
    const before = renderJoReadyCheckInvitation(recipient, snapshot).body;
    // Attempt a mutation (should be a no-op because the object is frozen).
    try { (snapshot as any).customerTotal = 9999; } catch { /* frozen in strict mode */ }
    const after = renderJoReadyCheckInvitation(recipient, snapshot).body;
    expect(after).toBe(before);
    expect(after).toContain("$3,600 including GST");
  });
});

// ---------------------------------------------------------------------------
// 8. Subjects + footer (shared, verbatim) + no obligation language
// ---------------------------------------------------------------------------
describe("subjects and footer", () => {
  test("ineligible subject", () => {
    expect(subjectForTemplate("ineligible", "Alex")).toBe("Your ceiling insulation eligibility result");
  });
  test("ready check subject personalised", () => {
    expect(subjectForTemplate("ready_check_invitation", "Alex"))
      .toBe("Great news, Alex—it’s your turn to book your free Ready Check!");
  });
  test("shared footer present on every template", () => {
    const bodies = [
      renderJoEstimateEmail("eligible_no_insulation_size_unknown", recipient, liveFigures()).body,
      renderJoIneligibleEmail(recipient, "Your property already has compliant insulation.").body,
      renderJoReadyCheckInvitation(recipient, snapshot).body,
    ];
    for (const b of bodies) {
      expect(b).toContain("DC Construction Solutions Pty Ltd trading as Home Insulation Victoria");
      expect(b).toContain("Reference: JOB-1001");
    }
  });
  test("ineligible includes the specific reason and review CTA", () => {
    const out = renderJoIneligibleEmail(recipient, "Your property already has compliant ceiling insulation.");
    expect(out.body).toContain("Your property already has compliant ceiling insulation.");
    expect(out.body).toContain("[Review my result →]");
  });
});

// ---------------------------------------------------------------------------
// 9. Purity / safety — module performs no sends (no provider/network symbols)
// ---------------------------------------------------------------------------
describe("module safety", () => {
  test("rendering is deterministic and side-effect free", () => {
    const a = renderJoEstimateEmail("potentially_eligible_unknown_size_unknown", recipient, liveFigures());
    const b = renderJoEstimateEmail("potentially_eligible_unknown_size_unknown", recipient, liveFigures());
    expect(a.body).toBe(b.body);
    expect(a.ctas).toEqual(["upload_media"]);
  });
  test("potentially-eligible body requests upload and does not offer Save my spot", () => {
    const out = renderJoEstimateEmail("potentially_eligible_unknown_size_known", recipient, liveFigures({ areaEstimated: false, ceilingAreaM2: 175 }));
    expect(out.body).toContain("[Tell us about your insulation]");
    expect(out.body).not.toContain("[Save my spot →]");
  });
});
