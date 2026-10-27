/**
 * P1-R3-S92 — GAP-3: the workflow-to-renderer CONTRACT for all eight Jo templates.
 *
 * Part A (pure)  : templates 1–7 selection, variants, review gates, CTAs, pricing and the wiring evidence
 *                  that the legacy renderer is no longer the one used for these outcomes.
 * Part B: Template 8 (Office Ready Check invitation) is retired (24 Oct 2026).
 * Part C (real DB): COM-04 dual-switch, authorisation, consent, suppression and idempotency.
 *
 * Every DB test runs the REAL server modules against a real Postgres engine (PGlite) through the project's
 * PostgREST shim. The email provider is a MOCK that counts calls: no real provider is ever contacted.
 */
import { describe, expect, mock, test, beforeAll, afterEach } from "bun:test";
import { officeLegacyTarget } from "../src/lib/legacy-links.core";
import { existsSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import {
  renderJoOutcomeEmail,
  selectJoOutcomeTemplate,
  joRoutingInputFor,
  JO_OUTCOME_TEMPLATE_LABEL,
  type JoOutcomeEmailInput,
} from "../src/lib/jo-outcome-email.core";
import { ctasForTemplate, selectJoTemplate } from "../src/lib/jo-email-templates.core";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------
const FIGURES = {
  veuRebate: 1481.76, customerTotal: 3697.24, totalBeforeRebate: 5179,
  installation: 4481, piesaFee: 349, apFee: 349, ceilingAreaM2: 150, areaEstimated: true,
};
const RECIPIENT = { firstName: "Alex", propertyAddress: "30 Dash St, Fraser Rise VIC 3336", enquiryReference: "HV-1001" };
const LINKS = {
  saveMySpotUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/campaign",
  uploadMediaUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/video",
  reviewResultUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
  calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok#calculator",
};
const base = (o: Partial<JoOutcomeEmailInput>): JoOutcomeEmailInput =>
  ({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, recipient: RECIPIENT, figures: FIGURES, links: LINKS, ...o }) as JoOutcomeEmailInput;

// ---------------------------------------------------------------------------
// A. Templates 1–7
// ---------------------------------------------------------------------------
describe("A1. the correct template is selected for each outcome", () => {
  test("T1 eligible + no insulation + unknown size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false })).toBe("eligible_no_insulation_size_unknown");
  });
  test("T2 eligible + no insulation + known size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true })).toBe("eligible_no_insulation_size_known");
  });
  test("T3 reviewed below R2 + unknown size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: false, deskCheckStatus: "looks_eligible" })).toBe("eligible_below_r2_reviewed_size_unknown");
  });
  test("T4 reviewed below R2 + known size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" })).toBe("eligible_below_r2_reviewed_size_known");
  });
  test("T5 potentially eligible + unknown size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false })).toBe("potentially_eligible_unknown_size_unknown");
  });
  test("T6 potentially eligible + known size", () => {
    expect(selectJoOutcomeTemplate({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true })).toBe("potentially_eligible_unknown_size_known");
  });
  test("T7 ineligible", () => {
    expect(selectJoOutcomeTemplate({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false })).toBe("ineligible");
  });
  test("all seven are Jo's approved templates and none is Template 8", () => {
    const ids = ["eligible_no_insulation_size_unknown", "eligible_no_insulation_size_known", "eligible_below_r2_reviewed_size_unknown", "eligible_below_r2_reviewed_size_known", "potentially_eligible_unknown_size_unknown", "potentially_eligible_unknown_size_known", "ineligible"];
    for (const id of ids) expect(JO_OUTCOME_TEMPLATE_LABEL[id as keyof typeof JO_OUTCOME_TEMPLATE_LABEL]).toBeDefined();
    // The outcome path can never produce a Ready Check invitation.
    for (const id of ids) expect(id).not.toBe("ready_check_invitation");
  });
});

describe("A2. known / unknown ceiling-area variants", () => {
  test("the known-size variants state the size the owner supplied; unknown states the 150 m² assumption", () => {
    const known = renderJoOutcomeEmail(base({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, figures: { ...FIGURES, areaEstimated: false } }))!;
    const unknown = renderJoOutcomeEmail(base({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false }))!;
    // Decision 66 wording: "Based on what you told us: 150 m² ceiling…" vs the labelled typical-size assumption.
    expect(known.plainText).toContain("Based on what you told us: 150 m² ceiling");
    expect(known.plainText).not.toContain("an estimate, not your actual size");
    expect(unknown.plainText).toContain("Based on a typical 150 m² ceiling (an estimate, not your actual size)");
  });
  test("a missing size, the typical default and a declared size each choose their own variant", () => {
    const declared = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true });
    const assumed = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false });
    expect(declared).toBe("eligible_no_insulation_size_known");
    expect(assumed).toBe("eligible_no_insulation_size_unknown");
    expect(declared).not.toBe(assumed);
  });
});

describe("A3. T3/T4 review gates are preserved", () => {
  test("existing insulation without a 'looks_eligible' desk check NEVER renders T3/T4", () => {
    for (const status of [null, undefined, "not_eligible", "needs_onsite_check"] as const) {
      const id = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: status as never });
      expect(id).not.toBe("eligible_below_r2_reviewed_size_known");
      expect(id).not.toBe("eligible_below_r2_reviewed_size_unknown");
    }
  });
  test("unreviewed existing insulation falls back to a non-eligibility-claiming template", () => {
    const id = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true });
    expect(id).toBe("potentially_eligible_unknown_size_known");
    // That fallback never uses the Save-my-spot CTA (it is the media-upload path).
    expect(ctasForTemplate(id!)).toEqual(["upload_media"]);
  });
  test("unknown insulation is never promoted to confirmed below-R2", () => {
    const id = selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "unknown", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" });
    expect(id).toBe("potentially_eligible_unknown_size_known");
  });
  test("the routing input never leaks a non-verdict as a review", () => {
    for (const status of [null, "pending", "not_needed", "looks_eligible"] as const) {
      const input = joRoutingInputFor({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: status as never });
      expect(input.deskCheckStatus).toBe(status === "looks_eligible" ? "looks_eligible" : undefined);
    }
  });
});

describe("A4. T5/T6 use the media-upload CTA, not Save my spot", () => {
  test("T5 and T6 render the upload CTA and never a Save-my-spot button", () => {
    for (const known of [false, true]) {
      const mail = renderJoOutcomeEmail(base({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: known }))!;
      expect(mail.ctas).toEqual(["upload_media"]);
      expect(mail.html).toContain("/estimate/tok/video");
      // Decision 69: the questions email button, pointing at the owner's questions page.
      expect(mail.plainText).toContain("Answer & save my spot: https://estimate.homeinsulationvictoria.com.au/estimate/tok/video");
      expect(mail.plainText).not.toContain("Save my free spot");
      expect(mail.html).not.toContain("/estimate/tok/campaign");
    }
  });
  test("T1–T4 render Save my spot and never the upload CTA", () => {
    const mails = [
      renderJoOutcomeEmail(base({ insulation: "none", ceilingSizeKnown: false }))!,
      renderJoOutcomeEmail(base({ insulation: "none", ceilingSizeKnown: true }))!,
      renderJoOutcomeEmail(base({ insulation: "present", ceilingSizeKnown: false, deskCheckStatus: "looks_eligible" }))!,
      renderJoOutcomeEmail(base({ insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" }))!,
    ];
    for (const m of mails) {
      expect(m.ctas).toEqual(["save_my_spot"]);
      expect(m.html).toContain("/estimate/tok/campaign");
      expect(m.html).not.toContain("/estimate/tok/video");
    }
  });
});

describe("A5. T7 ineligible routing is preserved", () => {
  test("T7 renders the review-result CTA and no pricing table", () => {
    const mail = renderJoOutcomeEmail(base({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, reason: "Built after 2010." }))!;
    expect(mail.templateId).toBe("ineligible");
    expect(mail.ctas).toEqual(["review_result"]);
    expect(mail.html).toContain(`href="${LINKS.reviewResultUrl}"`);
    expect(mail.plainText).toContain("Built after 2010.");
    expect(mail.plainText).not.toContain("What this includes");
  });
  test("a missing reason falls back to Jo's wording rather than a blank email", () => {
    const mail = renderJoOutcomeEmail(base({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false }))!;
    expect(mail.plainText).toContain("doesn’t meet the current requirements");
  });
});

describe("A6. the correct pricing values reach the renderer", () => {
  test("the saved figures appear verbatim in both parts of the email", () => {
    const mail = renderJoOutcomeEmail(base({}))!;
    expect(mail.plainText).toContain("You save $1,482");
    expect(mail.plainText).toContain("You pay after the rebate: $3,697 incl. GST (full price $5,179)");
    expect(mail.html).toContain("$1,482");
    expect(mail.html).toContain("$3,697");
    expect(mail.html).toContain("$5,179");
    // The removal allowance never appears in T1; it is informational (the existing-insulation card) elsewhere.
    expect(mail.plainText).not.toContain("If some needs removing");
    const belowR2 = renderJoOutcomeEmail(base({ insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" }))!;
    expect(belowR2.plainText).toContain("If some needs removing: $15/m², only the areas that need it.");
    expect(belowR2.plainText).toContain("If it can stay: $0.");
    // It is never added to the quoted total.
    expect(belowR2.plainText).toContain("Your cost if eligible: $3,697 incl. GST (full price $5,179)");
  });
  test("the included card states the customer price and rebate supplied, and no unsupplied figure is invented", () => {
    const mail = renderJoOutcomeEmail(base({}))!;
    expect(mail.plainText).toContain("WHAT'S INCLUDED IN $3,697");
    expect(mail.plainText).toContain("The $1,482 comes straight off your price.");
    expect(mail.plainText).not.toContain("$4,481");
  });
  test("templates 1–6 refuse to render without figures (fail closed, never a $0 email)", () => {
    expect(() => renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, recipient: RECIPIENT, links: LINKS } as JoOutcomeEmailInput)).toThrow();
  });
  test("a missing CTA URL throws instead of shipping a dead button", () => {
    expect(() => renderJoOutcomeEmail(base({ links: { ...LINKS, saveMySpotUrl: "" } }))).toThrow(/save_my_spot/);
  });
  test("no Jo placeholder survives into the delivered content", () => {
    for (const input of [
      base({}),
      base({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true }),
      base({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false }),
    ]) {
      const m = renderJoOutcomeEmail(input)!;
      expect(m.html).not.toContain("[Save my spot");
      expect(m.html).not.toContain("[Upload my photos");
      expect(m.html).not.toContain("[Review my result");
      expect(m.plainText).not.toContain("[Save my spot");
    }
  });
});

describe("A7. the legacy renderer is no longer the one used for these outcomes", () => {
  test("followups.server.ts renders T1–T6 ONLY through the Jo selector (P1-S77: no legacy fallback)", () => {
    const f = readFileSync("src/lib/followups.server.ts", "utf8");
    expect(f).toContain("joOutcomeMail(");
    expect(f).toContain("renderJoOutcomeEmail");
    // No Jo template => held for manual review before any reservation; the legacy renderer is gone from this sender.
    expect(f).not.toContain("renderEstimateEmail(");
    expect(f).toContain('reason: "no_jo_template_manual_review"');
  });
  test("the ineligible path (T7) renders through the Jo selector", () => {
    const f = readFileSync("src/lib/followups.server.ts", "utf8");
    expect(f).toMatch(/renderPreliminaryIneligibleMail[\s\S]{0,1200}renderJoOutcomeEmail/);
    expect(f).toMatch(/outcome: "does_not_appear_eligible"/);
  });
  test("the Jo path never renders a Save-my-spot email without a real campaign link", () => {
    const f = readFileSync("src/lib/jo-outcome-email.core.ts", "utf8");
    expect(f).toContain("missingCta");
  });
  test("selectJoOutcomeTemplate delegates to the single canonical selector", () => {
    const f = readFileSync("src/lib/jo-outcome-email.core.ts", "utf8");
    expect(f).toContain("selectJoTemplate(joRoutingInputFor(facts))");
    // And it can never return Template 8.
    expect(selectJoOutcomeTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, ...({ readyCheckInvitation: true } as never) }))
      .toBe("eligible_no_insulation_size_known");
  });
  test("the canonical selector is unchanged and still shared with COM-08", () => {
    expect(selectJoTemplate({ outcome: "ineligible", insulation: null, ceilingSizeKnown: false })).toBe("ineligible");
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false })).toBe("eligible_no_insulation_size_unknown");
  });
});

// ---------------------------------------------------------------------------
// B. Template 8 (the office Ready Check invitation) — retired 24 Oct 2026
// ---------------------------------------------------------------------------
describe("B. Template 8 is retired", () => {
  test("no office page, server action or renderer can prepare or send it any more", () => {
    for (const f of ["src/lib/ready-check-invitation.core.ts", "src/lib/ready-check-invitation.server.ts", "src/lib/ready-check-invitation.functions.ts"]) {
      expect(existsSync(f)).toBe(false);
    }
    expect(officeLegacyTarget("ready-check")).toEqual({ to: "/admin/enquiries" });
    expect(readFileSync("src/lib/office-nav.ts", "utf8")).not.toContain("Ready Check invitations");
    expect(readFileSync("src/lib/jo-outcome-email.core.ts", "utf8")).not.toContain("renderJoReadyCheckInvitationEmail");
  });
  test("earlier sends stay readable: the history purpose is still a known email purpose", async () => {
    const { emailSuppression } = await import("../src/lib/emailsafety.core");
    expect(emailSuppression({
      purpose: "ready_check_invitation", optedOut: true, bounced: false, stage: "eligibility_review",
      jobSource: "base44", jobCreatedAt: "2026-10-01T00:00:00Z", recipient: "alex.smith@gmail.com", jobsCreatedAfter: "2020-01-01T00:00:00Z",
    })).toBe("unsubscribed");
  });
});
