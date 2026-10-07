import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderLaunchCampaignEmail, renderLaunchGroupEmail, renderSaveSpotFromLikelyEmail } from "../src/lib/estimate-email";

const campaignUrl = `https://estimate.homeinsulationvictoria.com.au/estimate/${"A".repeat(43)}/campaign`;
const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/email/unsubscribe?t=${"U".repeat(43)}`;
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
    const want = renderSaveSpotFromLikelyEmail({ estimateUrl: campaignUrl.replace(/\/campaign$/, ""), outcome: "likely", apCount: 2, campaignUrl, campaignOptOutUrl: unsubscribeUrl,
      estimatedTotal: 3379, veuDiscount: 1470, grossProjectTotal: 4849, areaM2: 150, amountPayableNow: 0, estimatedRemainingBalance: 3379,
      firstName: "Sarah", address: base.address, reference: "HV-1", existingInsulationPresent: false, assessmentFee: 349, apFee: 349, installationPrice: 4151 });
    expect(got.html).toBe(want.html);
    expect(got.plainText).toBe(want.plainText);
  });
  test("no sender or preview calls the retired renderer directly for likely owners", () => {
    for (const f of [...files("src"), ...files("scripts")]) {
      if (f.endsWith("estimate-email.ts")) continue;
      const s = readFileSync(f, "utf8");
      if (f.endsWith("hot-leads-send.server.ts")) {
        expect(s).toMatch(/sendGroup === "likely"\s*\?\s*\(\(\) => \{ const m = renderSaveSpotFromLikelyEmail/);
        continue;
      }
      expect(s.includes("renderLaunchCampaignEmail(")).toBe(false);
    }
  });
});
