/**
 * Jo's T1–T8: size wording, area-source truthfulness and the shared Spot Saved visual system.
 *
 * PURE: renders through the same functions every send uses. No database, no provider, no sending.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  renderJoOutcomeEmail,
  renderJoReadyCheckInvitationEmail,
  type JoOutcomeEmailInput,
} from "../src/lib/jo-outcome-email.core";
import { joAreaBasis } from "../src/lib/jo-area-basis.core";
import { withUnsubscribe } from "../src/lib/emailsafety.core";

const RECIPIENT = {
  firstName: "Alex",
  propertyAddress: "12 Sample St, Melbourne VIC 3000",
  enquiryReference: "HV-0000",
};
const LINKS = {
  saveMySpotUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/campaign",
  uploadMediaUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok/video",
  reviewResultUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
  calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok#calculator",
};
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
const figures = (area: number, estimated: boolean) => ({
  veuRebate: 2600,
  customerTotal: 1900,
  totalBeforeRebate: 4500,
  installation: 3800,
  piesaFee: 350,
  apFee: 350,
  ceilingAreaM2: area,
  areaEstimated: estimated,
});

const render = (
  input: Partial<JoOutcomeEmailInput> & Pick<JoOutcomeEmailInput, "outcome" | "insulation">,
) =>
  withUnsubscribe(
    renderJoOutcomeEmail({
      ceilingSizeKnown: false,
      recipient: RECIPIENT,
      links: LINKS,
      ...input,
    })!,
    UNSUB,
  );

const UNKNOWN = [
  ["T1", { outcome: "likely_eligible", insulation: "none" }],
  ["T3", { outcome: "likely_eligible", insulation: "present", deskCheckStatus: "looks_eligible" }],
  ["T5", { outcome: "needs_onsite_confirmation", insulation: "unknown" }],
] as const;

const KNOWN = [
  ["T2", { outcome: "likely_eligible", insulation: "none" }],
  ["T4", { outcome: "likely_eligible", insulation: "present", deskCheckStatus: "looks_eligible" }],
  ["T6", { outcome: "needs_onsite_confirmation", insulation: "unknown" }],
] as const;

describe("A. size-unknown previews state the 150 m² assumption", () => {
  for (const [name, facts] of UNKNOWN) {
    test(`${name}: 150 m², labelled as an assumption, never as the owner's size`, () => {
      const m = render({ ...facts, ceilingSizeKnown: false, figures: figures(150, true) });
      expect(m.html).toContain("Ceiling size: 150 m² — estimated, not measured");
      expect(m.html).toContain("150 m² for this preliminary quote");
      expect(m.html).toContain("didn’t provide a ceiling size");
      expect(m.html).not.toContain("based on the size you provided");
    });
  }
});

describe("B. size-known previews state the provided size, not the assumption", () => {
  for (const [name, facts] of KNOWN) {
    test(`${name}: 210 m² sample, described as provided by the homeowner`, () => {
      const m = render({ ...facts, ceilingSizeKnown: true, figures: figures(210, false) });
      expect(m.html).toContain("Ceiling size: 210 m² — based on the size you provided");
      expect(m.html).not.toContain("150 m²");
      expect(m.html).not.toContain("didn’t provide a ceiling size");
      expect(m.html).not.toContain("estimated, not measured");
      expect(m.plainText).toContain("Ceiling size: 210 m² — based on the size you provided");
    });
  }
});

describe("C. real customer data is preserved, never replaced with the sample or the default", () => {
  test("a homeowner-provided 185 m² renders as 185 m²", () => {
    const m = render({
      outcome: "likely_eligible",
      insulation: "none",
      ceilingSizeKnown: true,
      figures: figures(185, false),
    });
    expect(m.html).toContain("Ceiling size: 185 m² — based on the size you provided");
    expect(m.html).not.toContain("150 m²");
    expect(m.html).not.toContain("210 m²");
  });
  test("a non-typical assumed size keeps its own figure and stays labelled assumed", () => {
    const m = render({
      outcome: "likely_eligible",
      insulation: "none",
      ceilingSizeKnown: false,
      figures: figures(150, true),
    });
    expect(m.html).toContain("Ceiling size: 150 m² — estimated, not measured");
  });
});

describe("D. property-research area is never described as homeowner-provided", () => {
  test("the single area-basis rule accepts only owner size or the labelled 150 m² default", () => {
    expect(
      joAreaBasis({ areaSource: "owner_estimate", areaM2: 185, ownerAreaM2: 185 }),
    ).toMatchObject({
      ok: true,
      ceilingSizeKnown: true,
      areaEstimated: false,
    });
    expect(
      joAreaBasis({ areaSource: "typical_default", areaM2: 150, ownerAreaM2: null }),
    ).toMatchObject({
      ok: true,
      ceilingSizeKnown: false,
      areaEstimated: true,
    });
    // Property research, measurements and mismatches fail closed — no misleading "you provided" claim.
    for (const areaSource of ["area_estimate", "accepted_measurement", null]) {
      expect(joAreaBasis({ areaSource, areaM2: 200, ownerAreaM2: null }).ok).toBe(false);
    }
    expect(joAreaBasis({ areaSource: "owner_estimate", areaM2: 200, ownerAreaM2: 185 }).ok).toBe(
      false,
    );
  });
  test("the Office draft path holds a researched/measured size instead of claiming the owner supplied it", () => {
    const src = readFileSync("src/lib/enquiry-groups.server.ts", "utf8");
    expect(src).toContain('if (!assumed && r.area.source !== "declared")');
    expect(src).toContain("came from ${from}, not the homeowner");
    expect(src).toContain('r.area.source === "estimated" ? "property research" : "a measurement"');
    expect(src).toContain("Jo's approved email only states an owner-provided size");
  });
  test("both real senders still gate on the shared area-basis rule", () => {
    for (const file of ["src/lib/hot-leads-send.server.ts", "src/lib/followups.server.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("joAreaBasis(");
      expect(src).toContain("areaBasis.ok) return");
    }
  });
});

describe("E. T1–T8 use the shared Spot Saved branded layout", () => {
  const brandChecks = (html: string) => {
    expect(html.startsWith("<!doctype html")).toBe(true);
    expect(html).toContain("hiv-logo");
    expect(html).toContain('class="hiv-main lx-main"');
    expect(html).toContain("Home Insulation Victoria");
    expect(html).toContain("DC Construction Solutions Pty Ltd trading as Home Insulation Victoria");
  };
  test("T1–T6, T7 and T8 all render inside the 640px branded shell with one footer", () => {
    const mails = [
      render({
        outcome: "likely_eligible",
        insulation: "none",
        ceilingSizeKnown: false,
        figures: figures(150, true),
      }),
      render({
        outcome: "likely_eligible",
        insulation: "none",
        ceilingSizeKnown: true,
        figures: figures(210, false),
      }),
      render({
        outcome: "needs_onsite_confirmation",
        insulation: "unknown",
        ceilingSizeKnown: true,
        figures: figures(210, false),
      }),
      render({
        outcome: "does_not_appear_eligible",
        insulation: null,
        reason: "Built after 2010.",
      }),
      withUnsubscribe(
        renderJoReadyCheckInvitationEmail(RECIPIENT, {
          ...figures(150, true),
          savedAt: "2026-10-19T00:00:00Z",
          personalEstimateUrl: "https://estimate.homeinsulationvictoria.com.au/my-estimate/tok",
          readyCheckBookingUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
        }),
        UNSUB,
      ),
    ];
    for (const m of mails) {
      brandChecks(m.html);
      expect(m.html.match(/DC Construction Solutions Pty Ltd/g)?.length).toBe(1);
      expect(m.html.match(/<html/g)?.length).toBe(1);
      expect(m.html.match(/<\/body>/g)?.length).toBe(1);
      expect(m.html.match(/Don’t want these emails\?/g)?.length).toBe(1);
      expect(m.html).toContain("Remove my enquiry");
    }
  });
  test("T7 keeps no estimate section and T8 keeps the Ready Check sections", () => {
    const t7 = render({
      outcome: "does_not_appear_eligible",
      insulation: null,
      reason: "Built after 2010.",
    });
    expect(t7.html).not.toContain("What this includes");
    expect(t7.html).not.toContain("Ceiling size");
    const t8 = withUnsubscribe(
      renderJoReadyCheckInvitationEmail(RECIPIENT, {
        ...figures(150, true),
        savedAt: "2026-10-19T00:00:00Z",
        personalEstimateUrl: "https://estimate.homeinsulationvictoria.com.au/my-estimate/tok",
        readyCheckBookingUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
      }),
      UNSUB,
    );
    expect(t8.html).toContain("Book your free Ready Check");
    expect(t8.html).not.toContain("Save my spot");
  });
});

describe("F. Jo's approved wording is unchanged", () => {
  test("verbatim headline, quote labels, includes table and savings lines survive", () => {
    const m = render({
      outcome: "likely_eligible",
      insulation: "none",
      ceilingSizeKnown: true,
      figures: figures(210, false),
    });
    // Escaped in HTML (curly apostrophes are preserved as-is).
    expect(m.html).toContain(
      "Good news—based on what you’ve told us, your home looks likely to qualify for a VEU ceiling insulation rebate.",
    );
    expect(m.html).toContain("Your estimated cost after rebate: $1,900 including GST");
    expect(m.html).toContain("Before rebate: $4,500 including GST");
    expect(m.html).toContain("You could save $2,600");
    expect(m.html).toContain("We’ll confirm the ceiling measurements at your free Ready Check.");
    expect(m.html).toContain("What this includes");
    expect(m.plainText).toContain("Home Insulation Victoria");
  });
  test("T7's approved ineligibility wording and T8's saved-quote wording are intact", () => {
    const t7 = render({
      outcome: "does_not_appear_eligible",
      insulation: null,
      reason: "Built after 2010.",
    });
    expect(t7.plainText).toContain(
      "your property doesn’t appear eligible for a VEU ceiling insulation rebate at this stage.",
    );
    expect(t7.plainText).toContain("Built after 2010.");
    const t8 = withUnsubscribe(
      renderJoReadyCheckInvitationEmail(RECIPIENT, {
        ...figures(150, true),
        savedAt: "2026-10-19T00:00:00Z",
        personalEstimateUrl: "https://estimate.homeinsulationvictoria.com.au/my-estimate/tok",
        readyCheckBookingUrl: "https://estimate.homeinsulationvictoria.com.au/estimate/tok",
      }),
      UNSUB,
    );
    expect(t8.plainText).toContain("You saved your spot. Now it’s your turn!");
    expect(t8.plainText).toContain("We’ve retained the pricing from your saved preliminary quote.");
  });
});

describe("G. email safety is unchanged", () => {
  test("the unsubscribe slot is filled once and no CTA placeholder survives", () => {
    const m = render({
      outcome: "likely_eligible",
      insulation: "none",
      ceilingSizeKnown: false,
      figures: figures(150, true),
    });
    expect(m.html).toContain(UNSUB);
    expect(m.html).not.toContain("data-hiv-remove-enquiry");
    expect(m.html).not.toContain("{{HIV_REMOVE_MY_ENQUIRY_LINK}}");
    expect(m.html).not.toMatch(/\[(Save my spot|Upload my photos|Review my result)[^\]]*\]/);
  });
  test("T5/T6 keep the upload CTA only; T1–T4 keep Save my spot only", () => {
    const expected: Record<string, string> = { T2: "/campaign", T4: "/campaign", T6: "/video" };
    for (const [name, facts] of KNOWN) {
      const m = render({ ...facts, ceilingSizeKnown: true, figures: figures(210, false) });
      expect(m.html).toContain(expected[name]!);
    }
    const t5 = render({
      outcome: "needs_onsite_confirmation",
      insulation: "unknown",
      ceilingSizeKnown: false,
      figures: figures(150, true),
    });
    expect(t5.html).not.toContain("/campaign");
  });
  test("the Templates preview uses template-specific sample data (210 known / 150 assumed)", () => {
    const src = readFileSync("src/components/portal/template-hub.tsx", "utf8");
    expect(src).toContain('const ceilingSizeKnown = templateId.endsWith("size_known")');
    expect(src).toContain("ceilingAreaM2: ceilingSizeKnown ? 210 : 150");
    expect(src).toContain("areaEstimated: !ceilingSizeKnown");
    expect(src).toContain("Sample values only.");
    expect(src).toContain("210 m² provided by the homeowner");
  });
});
