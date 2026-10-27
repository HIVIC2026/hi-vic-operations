/**
 * P1-S77 — ONE authoritative set of homeowner enquiry emails (Jo Lowe, 15 Oct 2026).
 *
 * Part A (pure): defects fixed in Jo's rendered templates — T1/T2 subject amount, footer links, T7 public
 *                calculator, no bracketed placeholders reach a customer. (T8, the office Ready Check invitation,
 *                was retired on 24 Oct 2026.)
 * Part B (source guarantees): no sending path, Office page or preview can reach a superseded renderer, and the
 *                retired template surfaces can no longer be listed, edited or previewed.
 */
import { describe, expect, test } from "bun:test";
import { officeLegacyTarget, publicLegacyTarget } from "../src/lib/legacy-links.core";
import { existsSync, readFileSync } from "node:fs";
import {
  renderJoOutcomeEmail,
  selectJoOutcomeTemplate,
  joFactsForSaveSpotVariant,
  type JoOutcomeEmailInput,
} from "../src/lib/jo-outcome-email.core";
import { subjectForTemplate } from "../src/lib/jo-email-templates.core";
import { withUnsubscribe, REMOVE_ENQUIRY_TEXT_SLOT } from "../src/lib/emailsafety.core";
import { PUBLIC_CALCULATOR_URL } from "../src/lib/estimate-email";
import { TEMPLATE_ENTRIES } from "../src/lib/template-hub.core";
import { CUSTOMER_COMMUNICATION_CATALOG } from "../src/lib/template-catalog";

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

describe("Part A — Jo template defects fixed", () => {
  test("T1/T2 subject states the real rebate amount (Jo: “[name], you could save $[rebate] on ceiling insulation”)", () => {
    expect(sent(ALL[0]![1]).subject).toBe("Alex, you could save $1,325 on ceiling insulation");
    expect(sent(ALL[1]![1]).subject).toBe("Alex, you could save $1,325 on ceiling insulation");
    expect(subjectForTemplate("eligible_no_insulation_size_known", "Alex")).toBe("Alex, you could save on ceiling insulation");
    for (const [, o] of ALL) expect(sent(o).subject).not.toContain("on your VEU rebate on");
  });

  test("no bracketed placeholder or unfilled slot ever reaches a customer (T1–T7, HTML and plain text)", () => {
    const mails = ALL.map(([, o]) => sent(o));
    for (const m of mails) {
      for (const bad of ["[Contact us]", "[Privacy]", "[Remove my enquiry]", "[Save my spot", "[Upload my photos", "[Review my result", "[Book my Ready Check", REMOVE_ENQUIRY_TEXT_SLOT, "data-hiv-remove-enquiry"]) {
        expect(m.html).not.toContain(bad);
        expect(m.plainText).not.toContain(bad);
      }
      // Decision 137: T1–T7 carry the approved footer (AP number · ABN · Unsubscribe).
      expect(m.html).toContain(`href="${UNSUB}"`);
      expect(m.html).toContain(">Unsubscribe</a>");
      expect(m.plainText).toContain(`Unsubscribe: ${UNSUB}`);
    }
  });

  test("T7 “Checking another property?” calculator opens the PUBLIC calculator; T1–T6 open the customer's own estimate", () => {
    const t7 = sent(ALL[6]![1]);
    // Decision 73: the T7 "Send to a friend" card opens the PUBLIC eligibility checker (no customer data in the link).
    expect(t7.plainText).toContain(`Send to a friend: ${PUBLIC_CALCULATOR_URL}`);
    expect(t7.html).toContain(`href="${PUBLIC_CALCULATOR_URL}"`);
    for (const [, o] of ALL.slice(0, 6)) {
      const m = sent(o);
      expect(m.plainText).toContain(`Try a different ceiling size: ${TOK}#calculator`);
      expect(m.html).toContain(`href="${TOK}#calculator"`);
      expect(m.plainText).not.toContain(`: ${PUBLIC_CALCULATOR_URL}\n`);
    }
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

  test("every homeowner enquiry sender renders only through renderJoOutcomeEmail", () => {
    for (const f of ["src/lib/hot-leads-send.server.ts", "src/lib/followups.server.ts", "src/lib/enquiry-groups.server.ts", "src/lib/lead-email-routing.server.ts", "src/lib/manual-communication.server.ts"]) {
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
    expect(h).toMatch(/(const|let) mail(: [^=]+)? = joMail;/);
    expect(h).toMatch(/if \(!joMail\) \{[\s\S]{0,400}status: "failed", provider: "not_sent"[\s\S]{0,200}return r\("blocked"/);
    const f = code("src/lib/followups.server.ts");
    expect(f).toContain('reason: "no_jo_template_manual_review"');
    expect(f).not.toMatch(/joOutcomeMail\([^)]*\)\s*\?\?/);
  });

  test("the existing-insulation follow-up is Jo T3/T4 and requires a recorded media/desk review", () => {
    const h = code("src/lib/hot-leads-send.server.ts");
    expect(h).toMatch(/followup\) \{[\s\S]{0,900}c\.mediaReview === "below_r2" \|\| desk === "looks_eligible"[\s\S]{0,400}deskCheckStatus: "looks_eligible"/);
  });

  test("Templates page shows Jo's enquiry designs (O1, O2 ×3 incl. decision 392 don't know, O6) through renderJoOutcomeEmail and none of the superseded entries (decision 379)", () => {
    const ids = TEMPLATE_ENTRIES.map((e) => e.id);
    for (const r of ["email:likely_estimate", "email:save_my_spot", "email:save_my_spot_no_size", "email:onsite_estimate", "email:insulation_details", "email:ineligible_result", "email:jo:ready_check_invitation"]) expect(ids).not.toContain(r);
    expect(TEMPLATE_ENTRIES.filter((e) => e.source.fn === "renderJoOutcomeEmail").map((e) => e.code)).toEqual(["O1", "O2", "O2", "O2", "O6"]);
    expect(JSON.stringify(TEMPLATE_ENTRIES.map(({ render: _r, ...e }) => e))).not.toContain("/admin/campaign-emails");
  });

  test("superseded review drafts and their editor are gone (stored versions stay in the database as history)", () => {
    expect(CUSTOMER_COMMUNICATION_CATALOG.map((c) => c[0])).toEqual(["estimate_unopened_3d", "area_unavailable"]);
    expect(existsSync("src/lib/customer-communications.functions.ts")).toBe(false);
    expect(existsSync("src/components/portal/CustomerDraftReview.tsx")).toBe(false);
    expect(code("src/routes/_authenticated/admin.communications.tsx")).not.toContain("saveCustomerCommunicationDraft");
    expect(code("src/routes/_authenticated/admin.templates.tsx")).not.toContain("CustomerDraftReview"); // empty list removed 21 Oct (Jo)
  });

  test("legacy preview / copy-editing pages redirect to Templates and cannot save copy", () => {
    expect(officeLegacyTarget("campaign-emails")).toEqual({ to: "/admin/templates", search: { cat: "owner" } });
    expect(publicLegacyTarget("step3-email-preview")).toEqual({ to: "/admin/templates", search: { cat: "owner" } });
    expect(existsSync("src/lib/campaign-emails.functions.ts")).toBe(false);
    expect(publicLegacyTarget("campaign-preview")).toEqual({ to: "/" });
    expect(officeLegacyTarget("launch-campaign")).toEqual({ to: "/admin/communications" });
    expect(code("src/lib/office-nav.ts")).not.toContain('"/admin/campaign-emails" }');
  });
});
