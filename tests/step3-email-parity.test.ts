// P1-S77 (supersedes Jo 7 Oct 17:22 "Step 3 is the only version"): Jo's approved templates (15 Oct 2026) are the ONLY
// version of each homeowner enquiry email. The send, the Office copy, the Jo TEST copy and the Templates preview all
// render through renderJoOutcomeEmail(); the Step 3 preview page and the campaign copy editor are retired.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderJoOutcomeEmail, type JoOutcomeEmailInput } from "../src/lib/jo-outcome-email.core";
import { withUnsubscribe } from "../src/lib/emailsafety.core";

const TOK = `https://estimate.homeinsulationvictoria.com.au/estimate/${"S".repeat(43)}`;
const UNSUB = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
const input = (sizeKnown: boolean): JoOutcomeEmailInput => ({
  outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: sizeKnown,
  recipient: { firstName: "Alex", propertyAddress: "1 Sample St, Melbourne VIC 3000", enquiryReference: "HV-0001" },
  figures: { veuRebate: 1325, customerTotal: 3747, totalBeforeRebate: 5072, installation: 4023, piesaFee: 349, apFee: 700, ceilingAreaM2: 150, areaEstimated: !sizeKnown },
  links: { saveMySpotUrl: `${TOK}/campaign`, uploadMediaUrl: `${TOK}/video`, reviewResultUrl: TOK, calculatorUrl: `${TOK}#calculator` },
});

describe("Jo's template is the only Save my spot email", () => {
  test("the real send, the Jo TEST copy and the Office copy use the Jo renderer; nothing calls the old save-spot swap", () => {
    const send = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
    expect(send).toContain("jo.renderJoOutcomeEmail(");
    expect(send).not.toMatch(/renderStep3SaveSpot|renderSaveSpotOfferEmail|renderLaunchCampaignEmail/);
    expect(readFileSync("src/lib/hot-leads.functions.ts", "utf8")).toContain("sendSaveMySpot([job.id]");
    expect(readFileSync("src/lib/manual-communication.server.ts", "utf8")).toContain("joFactsForSaveSpotVariant(");
  });
  test("the Step 3 preview page and the campaign copy editor are retired to Templates", () => {
    expect(readFileSync("src/routes/step3-email-preview.tsx", "utf8")).toContain('throw redirect({ to: "/admin/templates"');
    expect(readFileSync("src/routes/_authenticated/admin.campaign-emails.tsx", "utf8")).toContain('throw redirect({ to: "/admin/templates"');
    expect(readFileSync("src/lib/campaign-emails.functions.ts", "utf8")).toMatch(/if \(RETIRED\) throw new Error/);
  });
});

describe("T1 (size unknown) = T2 (size known) except the size disclosure", () => {
  test("same subject and the same Save my spot CTA", () => {
    const a = renderJoOutcomeEmail(input(true))!, b = renderJoOutcomeEmail(input(false))!;
    expect(b.subject).toBe(a.subject);
    for (const m of [a, b]) expect(m.html).toContain(`href="${TOK}/campaign"`);
  });
  test("only the size lines differ in the plain text", () => {
    const a = renderJoOutcomeEmail(input(true))!.plainText.split("\n"), b = renderJoOutcomeEmail(input(false))!.plainText.split("\n");
    expect(b.length).toBe(a.length);
    const changed = a.map((l, i) => [l, b[i]!] as const).filter(([x, y]) => x !== y);
    expect(changed.map(([x, y]) => [x, y])).toEqual([
      ["Ceiling size: 150 m² — based on the size you provided", "Ceiling size: 150 m² — estimated, not measured"],
      ["We’ll confirm the ceiling measurements at your free Ready Check.", "You didn’t provide a ceiling size, so we’ve used 150 m² for this preliminary quote. Your final price will depend on the measured ceiling area."],
    ]);
  });
  test("missing-size email states the 150 m² estimate; the size-known email never does", () => {
    const note = "You didn’t provide a ceiling size, so we’ve used 150 m² for this preliminary quote.";
    const t1 = withUnsubscribe(renderJoOutcomeEmail(input(false))!, UNSUB), t2 = withUnsubscribe(renderJoOutcomeEmail(input(true))!, UNSUB);
    expect(t1.plainText).toContain(note);
    expect(t1.html).toContain("Want to explore a different ceiling size?");
    expect(t2.plainText).not.toContain(note);
  });
});
