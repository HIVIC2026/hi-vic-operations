/**
 * Jo's T1–T7 (T8 retired 24 Oct 2026): size wording, area-source truthfulness and the approved email designs (decision 137).
 *
 * PURE: renders through the same functions every send uses. No database, no provider, no sending.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  basisLine,
  renderJoOutcomeEmail,
  type JoOutcomeEmailInput,
} from "../src/lib/jo-outcome-email.core";
import { joAreaBasis } from "../src/lib/jo-area-basis.core";
import { withUnsubscribe } from "../src/lib/emailsafety.core";
import { FOOTER_TEXT, LOGO_DATA_URI } from "../src/lib/email-kit.core";

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

const ASSUMED = "Based on a typical 150 m² ceiling (an estimate, not your actual size)";

describe("A. size-unknown previews state the 150 m² assumption", () => {
  for (const [name, facts] of UNKNOWN) {
    test(`${name}: 150 m², labelled as an assumption, never as the owner's size`, () => {
      const m = render({ ...facts, ceilingSizeKnown: false, figures: figures(150, true) });
      expect(m.plainText).toContain(ASSUMED);
      expect(m.html).toContain(ASSUMED);
      expect(m.html).not.toContain("Based on what you told us");
    });
  }
});

describe("B. size-known previews state the provided size, not the assumption", () => {
  for (const [name, facts] of KNOWN) {
    test(`${name}: 210 m² sample, described as provided by the owner`, () => {
      const m = render({ ...facts, ceilingSizeKnown: true, figures: figures(210, false) });
      expect(m.plainText).toContain("Based on what you told us: 210 m² ceiling");
      expect(m.html).toContain("Based on what you told us: 210 m² ceiling");
      expect(m.html).not.toContain("150 m²");
      expect(m.html).not.toContain("an estimate, not your actual size");
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
    expect(m.plainText).toContain("Based on what you told us: 185 m² ceiling, no existing insulation.");
    expect(m.html).not.toContain("150 m²");
    expect(m.html).not.toContain("210 m²");
  });
  test("a non-typical assumed size keeps its own figure and stays labelled assumed", () => {
    expect(basisLine({ ...figures(160, true) }, false)).toBe("Based on a typical 160 m² ceiling (an estimate, not your actual size), no existing insulation.");
    expect(basisLine({ ...figures(137, false) }, true)).toBe("Based on what you told us: 137 m² ceiling, with some existing insulation.");
  });
});

describe("D. property-research area is never described as owner-provided", () => {
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
    expect(src).toContain("came from ${from}, not the owner");
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

describe("E. T1–T7 use the approved email kit shell", () => {
  const brandChecks = (html: string) => {
    expect(html.startsWith("<!doctype html")).toBe(true);
    // The approved design: embedded logo PNG, the 540px card, one AP/ABN footer, no campaign art and no badge.
    expect(html).toContain(`<img src="${LOGO_DATA_URI}" width="116"`);
    expect(html).toContain("max-width:540px;background:#FBFCFA");
    expect(html).toContain(FOOTER_TEXT);
    expect(html).not.toContain("/api/public/email-art");
    expect(html).not.toContain('class="lx-badge"');
  };
  test("T1–T6 and T7 all render inside the approved card with one footer and one unsubscribe link", () => {
    const mails = [
      render({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, figures: figures(150, true) }),
      render({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, figures: figures(210, false) }),
      render({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, figures: figures(210, false) }),
      render({ outcome: "does_not_appear_eligible", insulation: null, reason: "Built after 2010." }),
    ];
    for (const m of mails) {
      brandChecks(m.html);
      expect(m.html.match(/DC Construction Solutions Pty Ltd/g)?.length).toBe(1);
      expect(m.html.match(/<html/g)?.length).toBe(1);
      expect(m.html.match(/<\/body>/g)?.length).toBe(1);
      // withUnsubscribe fills the inline slot: no second "Don't want these emails?" footer.
      expect(m.html.match(/>Unsubscribe<\/a>/g)?.length).toBe(1);
      expect(m.html).not.toContain("Don’t want these emails?");
      expect(m.plainText).toContain(`Unsubscribe: ${UNSUB}`);
    }
  });
  test("T7 keeps no estimate section", () => {
    const t7 = render({ outcome: "does_not_appear_eligible", insulation: null, reason: "Built after 2010." });
    expect(t7.html).not.toContain("What's included");
    expect(t7.html).not.toContain("Based on what you told us:");
    expect(t7.html).not.toContain("You save");
  });
});

describe("F. the approved wording (decisions 66, 67, 69, 73) is what renders", () => {
  test("O1 Save my spot: headline, intro, price box, save section and both cards", () => {
    const m = render({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, figures: figures(210, false) });
    expect(m.subject).toBe("Alex, you could save $2,600 on ceiling insulation");
    for (const t of [
      "Alex, you could save $2,600 on ceiling insulation",
      "To claim it, you need a certified installer, a licensed electrician and an accredited provider. We bring them all together and organise the whole job for you.",
      "Your estimated VEU rebate", "You save $2,600", "You pay after the rebate", "$1,900", "full price before rebate", "$4,500",
      "Try a different ceiling size", "Save your spot, it's free",
      // Decision 388 (Jo 25 Oct 2026): spot-only — no Ready Check, times or measuring before release.
      "Thousands of Victorians have registered, and spots are released in the order they were saved. Saving your spot is free, with no obligation. We'll be in touch when your spot is released.",
      "Save my free spot", "What's included in $1,900", "Licensed electrician safety check", "Premium R5.0 ceiling batts", "AS/NZS 4859.1",
      "Fitted by an EEC-certified installer", "AS 3999", "We handle the rebate", "A003654", "Not included, only if needed", "Removing old insulation", "Ceiling access fee", "Electrical fixes", "A bigger ceiling",
      "You'll know the exact price before you agree to anything.", "See your full estimate",
    ]) expect(m.html).toContain(t);
    expect(m.html).not.toContain("Ready Check");
    expect(m.html).toContain(`href="${LINKS.saveMySpotUrl}"`);
    expect(m.html).toContain(`href="${LINKS.calculatorUrl}"`);
    expect(m.html).not.toContain("may qualify");
    expect(m.html).not.toContain("Your existing insulation");
  });
  test("O2 some insulation (T3/T4): 'may qualify', potential rebate, the existing-insulation card and the R2.0 line", () => {
    const m = render({ outcome: "likely_eligible", insulation: "present", deskCheckStatus: "looks_eligible", ceilingSizeKnown: true, figures: { ...figures(137, false), removalUpTo: 2055 } });
    for (const t of [
      "Alex, you may qualify for $2,600 off ceiling insulation", "If it's thin or patchy (below R2.0)", "Your potential VEU rebate", "Your cost if eligible",
      "Your existing insulation", "it may be able to stay.", "If it can stay", "New batts go straight over the top", ">$0<", "If some needs removing", "Up to $2,055 for your 137 m² ceiling.", "$15/m²",
      "only if it can't stay ($15 per m², see above)", // decision 388: no "where they'll also check" Ready Check line
      "If your existing insulation is already R2.0 or above, the rebate isn't available and we'll let you know.",
    ]) expect(m.html).toContain(t);
    expect(m.html).toContain("Based on what you told us: 137 m² ceiling, with some existing insulation.");
  });
  test("O2 questions (T5/T6): three tap questions and the Answer & save my spot button to the owner's questions link", () => {
    const m = render({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, figures: figures(210, false) });
    for (const t of ["Save your spot: answer 3 quick questions", "Just tap, no typing.", "What type is it?", "About how thick is it?", "When was your home built?", "Answer &amp; save my spot", "Got photos or a video? You can add them too, only if it's safe."]) expect(m.html).toContain(t);
    expect(m.html).toContain(`href="${LINKS.uploadMediaUrl}"`);
    expect(m.html).not.toContain(`href="${LINKS.saveMySpotUrl}"`);
    expect(m.plainText).toContain(`Answer & save my spot: ${LINKS.uploadMediaUrl}`);
  });
  test("O6 not eligible (T7): result headline, Why box, Review my result, friend card", () => {
    const t7 = render({ outcome: "does_not_appear_eligible", insulation: null, reason: "Built after 2010." });
    for (const t of ["Alex, your ceiling insulation result", "We'd rather tell you now than waste your time.", ">Why<", "Built after 2010.", "Something doesn't look right?", "Review my result", "Know someone thinking about insulation?", "Send to a friend"]) expect(t7.html).toContain(t);
    expect(t7.html).toContain(`href="${LINKS.reviewResultUrl}"`);
    expect(t7.plainText).toContain("Built after 2010.");
  });
});

describe("G. email safety is unchanged", () => {
  test("the unsubscribe slot is filled once and no CTA placeholder survives", () => {
    const m = render({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, figures: figures(150, true) });
    expect(m.html).toContain(UNSUB);
    expect(m.html).not.toContain("data-hiv-remove-enquiry");
    expect(m.html).not.toContain("{{HIV_REMOVE_MY_ENQUIRY_LINK}}");
    expect(m.plainText).not.toContain("{{HIV_REMOVE_MY_ENQUIRY_LINK}}");
    expect(m.html).not.toMatch(/\[(Save my spot|Upload my photos|Review my result)[^\]]*\]/);
  });
  test("T5/T6 keep the upload CTA only; T1–T4 keep Save my spot only", () => {
    const expected: Record<string, string> = { T2: "/campaign", T4: "/campaign", T6: "/video" };
    for (const [name, facts] of KNOWN) {
      const m = render({ ...facts, ceilingSizeKnown: true, figures: figures(210, false) });
      expect(m.html).toContain(expected[name]!);
    }
    const t5 = render({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false, figures: figures(150, true) });
    expect(t5.html).not.toContain("/campaign");
  });
  test("the Templates page previews Jo's emails through the same renderer + opt-out wrapping as a real send (decision 379)", () => {
    const src = readFileSync("src/lib/template-hub.core.ts", "utf8");
    expect(src).toContain("const m = renderJoOutcomeEmail(input);");
    expect(src).toContain("const w = withUnsubscribe(m, UNSUB);");
    expect(readFileSync("src/components/portal/template-hub.tsx", "utf8")).toContain("TEST sample data.");
  });
});

describe("H. T1–T6 use the approved layout pieces", () => {
  const cases = [
    { outcome: "likely_eligible", insulation: "none" },
    { outcome: "likely_eligible", insulation: "present", deskCheckStatus: "looks_eligible" },
    { outcome: "needs_onsite_confirmation", insulation: "unknown" },
  ] as const;
  for (const c of cases) {
    test(`${c.outcome}/${c.insulation}: green rebate pill, big blue price, four ticked items (decision 388: no Ready Check row), four + items, green button`, () => {
      const m = render({ ...c, ceilingSizeKnown: true, figures: { ...figures(210, false), piesaFee: 349, apFee: 349 } });
      expect(m.html).toContain("border:2px solid #07BF61"); // green rebate pill
      expect(m.html).toContain("font-size:42px;font-weight:bold;color:#3C51C4"); // big price
      expect((m.html.match(/&#10003;<\/span>/g) ?? []).length).toBe(4 + (c.insulation === "none" ? 0 : 1)); // included ticks (decision 388: Ready Check row removed) (+ "If it can stay")
      expect((m.html.match(/>\+<\/span>/g) ?? []).length).toBe(4 + (c.insulation === "none" ? 0 : 1)); // not-included rows (+ "If some needs removing")
      expect(m.html).toContain('bgcolor="#07BF61"'); // the one approved button
      expect(m.html).not.toContain("#FDF2F6"); // no pink action card any more
    });
  }
});
