// P1-S77 (supersedes Jo 7 Oct 12:52 / Step 3 parity): Save my spot uses ONLY Jo's approved templates (15 Oct 2026).
// Likely-eligible owners receive Jo T1/T2 (no insulation) or T3/T4 (below R2, reviewed); no superseded renderer is
// reachable from any sender, preview or Office page.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderJoOutcomeEmail, type JoOutcomeEmailInput } from "../src/lib/jo-outcome-email.core";

const TOK = `https://estimate.homeinsulationvictoria.com.au/estimate/${"A".repeat(43)}`;
const base: JoOutcomeEmailInput = {
  outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true,
  recipient: { firstName: "Sarah", propertyAddress: "14 Example Street, Ballarat VIC 3350", enquiryReference: "HV-1" },
  figures: { veuRebate: 1470, customerTotal: 3379, totalBeforeRebate: 4849, installation: 4151, piesaFee: 349, apFee: 349, ceilingAreaM2: 150, areaEstimated: false },
  links: { saveMySpotUrl: `${TOK}/campaign`, uploadMediaUrl: `${TOK}/video`, reviewResultUrl: TOK, calculatorUrl: `${TOK}#calculator` },
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
}
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Superseded homeowner renderers. They may still be DEFINED (and used by retired, redirected routes) but never called by a live path. */
const LEGACY_CALL = /\b(renderLaunchCampaignEmail|renderLaunchGroupEmail|renderStep3SaveSpot|renderStep3SaveSpotNoSize|renderStep3Likely|renderSaveSpotFromLikelyEmail|renderSaveSpotOfferEmail)\s*\(/;
const DEFINITIONS = /src\/lib\/(estimate-email|step3-emails|step3-email-samples|save-spot-offer\.core)\.ts$/;
const RETIRED_ROUTES = /src\/routes\/(step3-email-preview|_authenticated\/admin\.campaign-emails)\.tsx$/;

describe("Save my spot uses only Jo's approved templates (15 Oct 2026)", () => {
  test("likely eligible, no insulation, size known → Jo T2 with the Save my spot CTA", () => {
    const m = renderJoOutcomeEmail(base)!;
    expect(m.templateId).toBe("eligible_no_insulation_size_known");
    expect(m.ctas).toEqual(["save_my_spot"]);
    expect(m.subject).toBe("Sarah, you could save $1,470 on ceiling insulation");
    expect(m.html).toContain(`href="${TOK}/campaign"`);
  });
  test("likely eligible, no insulation, size unknown → Jo T1 stating the 150 m² estimate", () => {
    const m = renderJoOutcomeEmail({ ...base, ceilingSizeKnown: false, figures: { ...base.figures!, areaEstimated: true } })!;
    expect(m.templateId).toBe("eligible_no_insulation_size_unknown");
    expect(m.plainText).toContain("Based on a typical 150 m² ceiling (an estimate, not your actual size)");
  });
  test("no live sender, preview or Office page calls a superseded renderer", () => {
    const offenders: string[] = [];
    for (const f of [...files("src"), ...files("scripts")]) {
      if (DEFINITIONS.test(f)) continue;
      const s = readFileSync(f, "utf8");
      if (RETIRED_ROUTES.test(f)) { expect(s).toContain('throw redirect({ to: "/admin/templates"'); continue; }
      if (LEGACY_CALL.test(code(s))) offenders.push(f);
    }
    expect(offenders).toEqual([]);
    const send = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
    expect(send).toContain("jo.renderJoOutcomeEmail(");
  });
});
