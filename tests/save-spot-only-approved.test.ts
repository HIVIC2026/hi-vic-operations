import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderLaunchCampaignEmail, renderLaunchGroupEmail } from "../src/lib/estimate-email";
import { renderStep3SaveSpot } from "../src/lib/step3-emails";

const campaignUrl = `https://estimate.homeinsulationvictoria.com.au/estimate/${"A".repeat(43)}/campaign`;
const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${"U".repeat(43)}`;
const base = { campaignUrl, unsubscribeUrl, firstName: "Sarah", estimatedTotal: 3379, veuDiscount: 1470, grossTotal: 4849, areaM2: 150, address: "14 Example Street, Ballarat VIC 3350", reference: "HV-1" };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
}

describe("Save my spot uses only the approved email (Jo, 7 Oct 12:52)", () => {
  test("old v9 likely version refuses to render", () => {
    expect(() => renderLaunchCampaignEmail({ ...base, group: "likely" })).toThrow();
  });
  test("likely group renders exactly the approved email", () => {
    const got = renderLaunchGroupEmail({ ...base, group: "likely" });
    const want = renderStep3SaveSpot({ estimateUrl: campaignUrl.replace(/\/campaign$/, ""), campaignUrl, unsubscribeUrl,
      estimatedTotal: 3379, veuDiscount: 1470, grossTotal: 4849, areaM2: 150, firstName: "Sarah", address: base.address, reference: "HV-1", existingInsulationPresent: false });
    expect(got.html).toBe(want.html);
    expect(got.plainText).toBe(want.plainText);
  });
  test("no sender or preview calls the retired renderer directly for likely owners", () => {
    for (const f of [...files("src"), ...files("scripts")]) {
      if (f.endsWith("estimate-email.ts")) continue;
      const s = readFileSync(f, "utf8");
      if (f.endsWith("hot-leads-send.server.ts")) {
        // P1-S77: the Save my spot sender renders ONLY Jo's approved templates (T1–T4) — no Step 3 builder either.
        expect(s).toContain("jo.renderJoOutcomeEmail(");
        expect(/\brenderStep3(Likely|SaveSpot)\s*\(/.test(s)).toBe(false);
      }
      expect(s.includes("renderLaunchCampaignEmail(")).toBe(false);
    }
  });
});
