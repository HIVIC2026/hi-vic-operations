// Jo, 7 Oct 17:22 UTC: the Step 3 email preview is the ONLY version of each customer email.
// Every send / test / preview path must render byte-identical HTML for the same facts.
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderStep3SaveSpot, renderStep3SaveSpotNoSize, STEP3_SAVESPOT_SAMPLE as S } from "../src/lib/step3-emails";
import { renderLaunchGroupEmail } from "../src/lib/estimate-email";

const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) ? [p] : []; });

describe("Step 3 is the only Save my spot email", () => {
  test("campaign/launch preview path renders the same HTML as Step 3", () => {
    const step3 = renderStep3SaveSpot(S);
    const viaCampaign = renderLaunchGroupEmail({ group: "likely", referralUrl: S.referralUrl, campaignUrl: S.campaignUrl, unsubscribeUrl: S.unsubscribeUrl, firstName: S.firstName, estimatedTotal: S.estimatedTotal, veuDiscount: S.veuDiscount, grossTotal: S.grossTotal, areaM2: S.areaM2, address: S.address, reference: S.reference, insulation: "none", installation: S.installation, assessmentFee: S.assessmentFee, apFee: S.apFee });
    expect(viaCampaign.html).toBe(step3.html);
    expect(viaCampaign.subject).toBe(step3.subject);
    expect(viaCampaign.plainText).toBe(step3.plainText);
  });
  test("nothing else calls the Save my spot renderer directly", () => {
    const offenders = files("src").filter((f) => !/src\/lib\/(estimate-email|step3-emails)\.ts$/.test(f) && /renderSaveSpotFromLikelyEmail\(/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  test("P1-S77: the real send and the test button use Jo's approved template; the Step 3 preview page is retired", () => {
    const send = readFileSync("src/lib/hot-leads-send.server.ts", "utf8");
    expect(send).toContain("jo.renderJoOutcomeEmail(");
    expect(send).not.toContain("renderStep3SaveSpot");
    expect(readFileSync("src/lib/hot-leads.functions.ts", "utf8")).toContain("sendSaveMySpot([job.id]");
    expect(readFileSync("src/routes/step3-email-preview.tsx", "utf8")).toContain('throw redirect({ to: "/admin/templates"');
  });
  test("the campaign editor cannot change the locked Save my spot wording", () => {
    expect(readFileSync("src/routes/_authenticated/admin.campaign-emails.tsx", "utf8")).toContain("Wording locked");
  });
});

import { renderStep3Likely, saveSpotDifferences } from "../src/lib/step3-emails";
describe("Save your spot = Step 3 likely email + four swaps only", () => {
  test("same subject and preview text", () => {
    expect(renderStep3SaveSpot(S).subject).toBe(renderStep3Likely(S).subject);
    expect(renderStep3SaveSpot(S).previewText).toBe(renderStep3Likely(S).previewText);
  });
  test("HTML differs only in heading, paragraph, button and small line", () => {
    const a = renderStep3Likely(S).html.replace(/></g, ">\n<").split("\n"), b = renderStep3SaveSpot(S).html.replace(/></g, ">\n<").split("\n");
    expect(b.length).toBe(a.length);
    const changed = a.map((l, i) => [l, b[i]!] as const).filter(([x, y]) => x !== y);
    expect(changed.length).toBe(4);
    expect(changed.map(([, y]) => y).join(" ")).toContain("Save your spot");
    expect(changed.map(([, y]) => y).join(" ")).toContain("Save my spot →");
    expect(changed.map(([, y]) => y).join(" ")).toContain(`href="${S.campaignUrl}"`);
  });
  test("plain text differs in exactly those four places", () => {
    expect(saveSpotDifferences(S).length).toBe(4);
  });
});

 test("missing-size email uses an explicit average and preserves the approved email", () => {
 const email = renderStep3SaveSpotNoSize(S);
 const note = "You didn’t provide a ceiling size, so we’ve used an average size of 150 m² for this preliminary estimate.";
 expect(email.html).toContain(note);
 expect(email.plainText).toContain(note);
 expect(email.html).toContain("Want to explore a different ceiling size?");
 expect(email.html).toContain(`href="${S.campaignUrl}"`);
 expect(email.subject).toBe(renderStep3SaveSpot(S).subject);
 expect(renderStep3SaveSpot(S).html).not.toContain(note);
 });
