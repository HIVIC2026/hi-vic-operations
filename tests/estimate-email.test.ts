import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail } from "../src/lib/estimate-email";

const sampleUrl = "https://quote.homeinsulationvictoria.com.au/estimate/sample-secure-link";
const email = renderEstimateEmail({ estimateUrl: sampleUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1 });

describe("Step 3 email renderer", () => {
  test("contains price, discount, preheader, qualifications, benefits and next steps in both formats", () => {
    expect(email.subject).toBe("Good news — your home looks likely to qualify for a VEU insulation discount");
    expect(email.previewText).toContain("personalised HI VIC estimate is ready");
    for (const copy of ["$3,396", "$1,325", "134.1", "licensed electrician", "Registered Electrical Contractor", "EEC Certified Insulation Installer", "$400+ / year*", "Up to 20%*", "Actual savings vary", "Here's what happens next", "$349", "Transparent HI VIC pricing", "DC Construction Solutions Pty Ltd t/a Home Insulation Victoria"]) {
      expect(email.html).toContain(copy);
      expect(email.plainText).toContain(copy);
    }
    expect(email.html).toContain(sampleUrl);
    expect(email.plainText).toContain(sampleUrl);
  });

  test("is email-safe and contains no delivery or provider integration", () => {
    const source = readFileSync("src/lib/estimate-email.ts", "utf8");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    expect(email.html).not.toMatch(/<script\b|lovable\.app|class=|<style\b/i);
    expect(email.plainText).not.toContain("lovable.app");
    expect(source + preview).not.toMatch(/sendTemplateEmail|sendLovableEmail|createServerFn|supabase|fetch\(|\.insert\(|\.update\(|onClick/);
    expect(preview).toContain("srcDoc={sample.html}");
    expect(preview).toContain("sample-secure-link");
  });

  test("rejects external, insecure, and query-bearing links", () => {
    for (const url of ["https://example.com/estimate/token", "http://quote.homeinsulationvictoria.com.au/estimate/token", "https://quote.homeinsulationvictoria.com.au/estimate/token?leak=1"]) {
      expect(() => renderEstimateEmail({ estimateUrl: url, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1 })).toThrow();
    }
  });
});