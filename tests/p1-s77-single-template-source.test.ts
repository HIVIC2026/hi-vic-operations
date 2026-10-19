/**
 * P1-S77 — ONE authoritative set of homeowner enquiry emails (Jo Lowe, 15 Oct 2026).
 *
 * Part A (pure): defects fixed in Jo's rendered templates — T1/T2 subject amount, footer links, T7 public
 *                calculator, T8 personal estimate link, no bracketed placeholders reach a customer.
 * Part B (source guarantees): no sending path, Office page or preview can reach a superseded renderer, and the
 *                retired template surfaces can no longer be listed, edited or previewed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  renderJoOutcomeEmail,
  renderJoReadyCheckInvitationEmail,
  selectJoOutcomeTemplate,
  joFactsForSaveSpotVariant,
  JO_FOOTER_LINKS_LINE,
  JO_CONTACT_URL,
  type JoOutcomeEmailInput,
} from "../src/lib/jo-outcome-email.core";
import { subjectForTemplate } from "../src/lib/jo-email-templates.core";
import { withUnsubscribe, REMOVE_ENQUIRY_TEXT_SLOT } from "../src/lib/emailsafety.core";
import { PRIVACY_URL, PUBLIC_CALCULATOR_URL } from "../src/lib/estimate-email";
import { TEMPLATE_ENTRIES, RETIRED_EMAIL_ENTRY_IDS } from "../src/lib/template-hub.core";
import { RETIRED_COMMUNICATION_KEYS, isRetiredCommunicationKey } from "../src/lib/template-catalog";

const FIG = { veuRebate: 1325, customerTotal: 3747, totalBeforeRebate: 5072, installation: 4023, piesaFee: 349, apFee: 700, ceilingAreaM2: 150, areaEstimated: true };
const WHO = { firstName: "Alex", propertyAddress: "1 Test St, St Kilda VIC 3182", enquiryReference: "HV-TEST" };
const TOK = "https://estimate.homeinsulationvictoria.com.au/estimate/tok";
const LINKS = { saveMySpotUrl: `${TOK}/campaign`, uploadMediaUrl: `${TOK}/video`, reviewResultUrl: TOK, calculatorUrl: `${TOK}#calculator` };
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"A".repeat(43)}`;
const input = (o: Partial<JoOutcomeEmailInput>): JoOutcomeEmailInput => ({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, recipient: WHO, figures: FIG, links: LINKS, ...o });

const ALL: Array<[string, Partial<JoOutcomeEmailInput>]> = [
  ["T1", { insulation: "none", ceilingSizeKnown: false }],
  ["T2", { insulation: "none", ceilingSizeKnown: true, figures: { ...FIG, areaEstimated: false } }],
  ["T3", { insulation: "present", deskCheckStatus: "looks_eligible", ceilingSizeKnown: false }],
  ["T4", { insulation: "present", deskCheckStatus: "looks_eligible", ceilingSizeKnown: true, figures: { ...FIG, areaEstimated: false } }],
  ["T5", { outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false }],
  ["T6", { outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, figures: { ...FIG, areaEstimated: false } }],
  ["T7", { outcome: "does_not_appear_eligible", insulation: null, reason: "The home was built after 2005." }],
];
const sent = (o: Partial<JoOutcomeEmailInput>) => withUnsubscribe(renderJoOutcomeEmail(input(o))!, UNSUB);
const t8 = () => withUnsubscribe(renderJoReadyCheckInvitationEmail(WHO, { ...FIG, savedAt: "2026-10-01T00:00:00Z", personalEstimateUrl: TOK, readyCheckBookingUrl: `${TOK}#confirm` }), UNSUB);

describe("Part A — Jo template defects fixed", () => {
  test("T1/T2 subject states the real rebate amount (Jo: “[name], you could save $[rebate] on ceiling insulation”)", () => {
    expect(sent(ALL[0]![1]).subject).toBe("Alex, you could save $1,325 on ceiling insulation");
    expect(sent(ALL[1]![1]).subject).toBe("Alex, you could save $1,325 on ceiling insulation");
    expect(subjectForTemplate("eligible_no_insulation_size_known", "Alex")).toBe("Alex, you could save on ceiling insulation");
    for (const [, o] of ALL) expect(sent(o).subject).not.toContain("on your VEU rebate on");
  });

  test("no bracketed placeholder or unfilled slot ever reaches a customer (T1–T8, HTML and plain text)", () => {
    const mails = [...ALL.map(([, o]) => sent(o)), t8()];
    for (const m of mails) {
      for (const bad of ["[Contact us]", "[Privacy]", "[Remove my enquiry]", "[Save my spot", "[Upload my photos", "[Review my result", "[Book my Ready Check", REMOVE_ENQUIRY_TEXT_SLOT, "data-hiv-remove-enquiry"]) {
        expect(m.html).not.toContain(bad);
        expect(m.plainText).not.toContain(bad);
      }
      expect(m.html).toContain(`href="${JO_CONTACT_URL}"`);
      expect(m.html).toContain(`href="${PRIVACY_URL}"`);
      expect(m.html).toContain(`>Remove my enquiry</a>`);
      expect(m.plainText).toContain(`Contact us: ${JO_CONTACT_URL} · Privacy: ${PRIVACY_URL} · Remove my enquiry: ${UNSUB}`);
      expect(m.plainText).toContain(`Unsubscribe: ${UNSUB}`);
    }
    expect(JO_FOOTER_LINKS_LINE).toBe("[Contact us] · [Privacy] · [Remove my enquiry]");
  });

  test("T7 “Checking another property?” calculator opens the PUBLIC calculator; T1–T6 open the customer's own estimate", () => {
    const t7 = sent(ALL[6]![1]);
    expect(t7.plainText).toContain(`Open the calculator →: ${PUBLIC_CALCULATOR_URL}`);
    expect(t7.html).toContain(`href="${PUBLIC_CALCULATOR_URL}"`);
    for (const [, o] of ALL.slice(0, 6)) {
      const m = sent(o);
      expect(m.plainText).toContain(`Open the calculator →: ${TOK}#calculator`);
      expect(m.plainText).not.toContain(`: ${PUBLIC_CALCULATOR_URL}\n`);
    }
  });

  test("T8 calculator and booking links are the customer's own (saved pricing) — never the public calculator", () => {
    const m = t8();
    expect(m.plainText).toContain(`Open the calculator →: ${TOK}`);
    expect(m.plainText).toContain(`Book my Ready Check →: ${TOK}#confirm`);
    expect(m.html).not.toContain(`href="${PUBLIC_CALCULATOR_URL}"`);
  });

  test("Office Save-my-spot variants map onto Jo's templates (no separate variant copy)", () => {
    expect(selectJoOutcomeTemplate(joFactsForSaveSpotVariant("no_insulation_owner_size", false))).toBe("eligible_no_insulation_size_known");
    expect(selectJoOutcomeTemplate(joFactsForSaveSpotVariant("no_insulation_assumed_size", true))).toBe("eligible_no_insulation_size_unknown");
    expect(selectJoOutcomeTemplate(joFactsForSaveSpotVariant("reviewed_under_r2", false))).toBe("eligible_below_r2_reviewed_size_known");
    expect(selectJoOutcomeTemplate(joFactsForSaveSpotVariant("reviewed_under_r2", true))).toBe("eligible_below_r2_reviewed_size_unknown");
  });
});

const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const code = (p: string) => src(p).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

describe("Part B — one template source; superseded templates unreachable", () => {
  const LEGACY = ["renderStep3SaveSpot", "renderStep3Likely", "renderStep3SaveSpotNoSize", "renderLaunchCampaignEmail", "renderLaunchGroupEmail", "renderSaveSpotOfferEmail", "renderEstimateEmail", "renderIneligibleOutcomeEmail", "renderIneligibleEmail", "renderInsulationVideoEmail", "renderSaveSpotFromLikelyEmail"];

  test("every homeowner enquiry sender renders only through renderJoOutcomeEmail / renderJoReadyCheckInvitationEmail", () => {
    for (const f of ["src/lib/hot-leads-send.server.ts", "src/lib/followups.server.ts", "src/lib/enquiry-groups.server.ts", "src/lib/ready-check-invitation.server.ts", "src/lib/lead-email-routing.server.ts", "src/lib/manual-communication.server.ts"]) {
      const c = code(f);
      for (const l of LEGACY) expect({ f, l, used: new RegExp(`\\b${l}\\s*\\(`).test(c) }).toEqual({ f, l, used: false });
    }
    expect(code("src/lib/hot-leads-send.server.ts")).toContain("renderJoOutcomeEmail(");
    expect(code("src/lib/followups.server.ts")).toContain("renderJoOutcomeEmail(");
    expect(code("src/lib/enquiry-groups.server.ts")).toContain("renderJoOutcomeEmail(");
  });

  test("no fallback: when no Jo template applies the sender holds for manual review (and releases any reservation)", () => {
    const h = code("src/lib/hot-leads-send.server.ts");
    expect(h).not.toMatch(/joMail\s*\?\?/);
    expect(h).toContain("const mail = joMail;");
    expect(h).toMatch(/if \(!joMail\) \{[\s\S]{0,400}status: "failed", provider: "not_sent"[\s\S]{0,200}return r\("blocked"/);
    const f = code("src/lib/followups.server.ts");
    expect(f).toContain('reason: "no_jo_template_manual_review"');
    expect(f).not.toMatch(/joOutcomeMail\([^)]*\)\s*\?\?/);
  });

  test("the existing-insulation follow-up is Jo T3/T4 and requires a recorded media/desk review", () => {
    const h = code("src/lib/hot-leads-send.server.ts");
    expect(h).toMatch(/followup\) \{[\s\S]{0,900}c\.mediaReview === "below_r2" \|\| desk === "looks_eligible"[\s\S]{0,400}deskCheckStatus: "looks_eligible"/);
  });

  test("Templates hub lists Jo's eight and none of the superseded entries", () => {
    const ids = TEMPLATE_ENTRIES.map((e) => e.id);
    for (const r of RETIRED_EMAIL_ENTRY_IDS) expect(ids).not.toContain(r);
    expect(ids.filter((i) => i.startsWith("email:jo:"))).toHaveLength(8);
    expect(JSON.stringify(TEMPLATE_ENTRIES)).not.toContain("/admin/campaign-emails");
  });

  test("superseded review drafts cannot be listed, edited or approved in Customer communications", () => {
    expect([...RETIRED_COMMUNICATION_KEYS].sort()).toEqual(["ineligible_result", "likely_estimate", "onsite_estimate"]);
    expect(isRetiredCommunicationKey("estimate_unopened_3d")).toBe(false);
    const fn = code("src/lib/customer-communications.functions.ts");
    expect(fn.match(/isRetiredCommunicationKey\(/g)?.length).toBe(2);
    expect(code("src/routes/_authenticated/admin.communications.tsx")).toContain("filter(([k]) => !isRetiredCommunicationKey(k))");
  });

  test("legacy preview / copy-editing pages redirect to Templates and cannot save copy", () => {
    for (const f of ["src/routes/_authenticated/admin.campaign-emails.tsx", "src/routes/step3-email-preview.tsx"]) {
      expect(code(f)).toMatch(/beforeLoad: \(\) => \{ throw redirect\(\{ to: "\/admin\/templates"/);
    }
    expect(code("src/lib/campaign-emails.functions.ts")).toMatch(/if \(RETIRED\) throw new Error/);
    expect(code("src/routes/campaign-preview.tsx")).not.toContain("renderLaunchGroupEmail");
    expect(code("src/routes/_authenticated/admin.launch-campaign.tsx")).not.toContain("renderLaunchGroupEmail");
    expect(code("src/lib/office-nav.ts")).not.toContain('"/admin/campaign-emails" }');
  });
});
