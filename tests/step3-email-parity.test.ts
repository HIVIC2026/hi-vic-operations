// P1-S77 (supersedes Jo 7 Oct 17:22 "Step 3 is the only version"): Jo's approved templates (15 Oct 2026) are the ONLY
// version of each homeowner enquiry email. The send, the Office copy, the Jo TEST copy and the Templates preview all
// render through renderJoOutcomeEmail(); the Step 3 preview page and the campaign copy editor are retired.
import { describe, expect, test } from "bun:test";
import { officeLegacyTarget, publicLegacyTarget } from "../src/lib/legacy-links.core";
import { existsSync, readFileSync } from "node:fs";
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
    // The old Step 3 preview "Send test" action was removed with that page (24 Oct 2026); Jo's TEST copy remains.
    expect(readFileSync("src/lib/hot-leads.functions.ts", "utf8")).not.toContain("sendSaveSpotPreviewTest");
    expect(readFileSync("src/lib/hot-leads.functions.ts", "utf8")).toContain('mode: "test_to_jo"');
    expect(readFileSync("src/lib/manual-communication.server.ts", "utf8")).toContain("joFactsForSaveSpotVariant(");
  });
  test("the Step 3 preview page and the campaign copy editor are retired to Templates", () => {
    expect(publicLegacyTarget("step3-email-preview")?.to).toBe("/admin/templates");
    expect(officeLegacyTarget("campaign-emails")?.to).toBe("/admin/templates");
    expect(existsSync("src/lib/campaign-emails.functions.ts")).toBe(false);
    expect(existsSync("src/lib/step3-emails.ts")).toBe(false);
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
      ["Based on what you told us: 150 m² ceiling, no existing insulation.", "Based on a typical 150 m² ceiling (an estimate, not your actual size), no existing insulation."],
    ]);
  });
  test("missing-size email states the 150 m² estimate; the size-known email never does", () => {
    const note = "Based on a typical 150 m² ceiling (an estimate, not your actual size)";
    const t1 = withUnsubscribe(renderJoOutcomeEmail(input(false))!, UNSUB), t2 = withUnsubscribe(renderJoOutcomeEmail(input(true))!, UNSUB);
    expect(t1.plainText).toContain(note);
    expect(t1.html).toContain("Try a different ceiling size");
    expect(t2.plainText).not.toContain(note);
  });
});
