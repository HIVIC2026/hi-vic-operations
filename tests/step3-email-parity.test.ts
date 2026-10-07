// Jo, 7 Oct 17:22 UTC: the Step 3 email preview is the ONLY version of each customer email.
// Every send / test / preview path must render byte-identical HTML for the same facts.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderStep3SaveSpot, STEP3_SAVESPOT_SAMPLE as S } from "../src/lib/step3-emails";
import { renderLaunchGroupEmail } from "../src/lib/estimate-email";

const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe("Step 3 is the only Save my spot email", () => {
  test("campaign/launch preview path renders the same HTML as Step 3", () => {
    const step3 = renderStep3SaveSpot(S);
    const viaCampaign = renderLaunchGroupEmail({ group: "likely", campaignUrl: S.campaignUrl, unsubscribeUrl: S.unsubscribeUrl, firstName: S.firstName, estimatedTotal: S.estimatedTotal, veuDiscount: S.veuDiscount, grossTotal: S.grossTotal, areaM2: S.areaM2, address: S.address, reference: S.reference, insulation: "none", installation: S.installation, assessmentFee: S.assessmentFee, apFee: S.apFee });
    expect(viaCampaign.html).toBe(step3.html);
    expect(viaCampaign.subject).toBe(step3.subject);
    expect(viaCampaign.text).toBe(step3.text);
  });
  test("nothing else calls the Save my spot renderer directly", () => {
    const offenders = files("src").filter((f) => !/src\/lib\/(estimate-email|step3-emails)\.ts$/.test(f) && /renderSaveSpotFromLikelyEmail\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  test("Step 3 page, real send and test button all use the Step 3 builder", () => {
    expect(readFileSync("src/routes/step3-email-preview.tsx", "utf8")).toContain("renderStep3SaveSpot(STEP3_SAVESPOT_SAMPLE)");
    const send = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
    expect(send).toContain("renderStep3SaveSpot({");
    expect(readFileSync("src/lib/hot-leads.functions.ts", "utf8")).toContain("sendSaveMySpot([job.id]");
  });
  test("the campaign editor cannot change the locked Save my spot wording", () => {
    expect(readFileSync("src/routes/_authenticated/admin.campaign-emails.tsx", "utf8")).toContain("Wording locked");
  });
});
