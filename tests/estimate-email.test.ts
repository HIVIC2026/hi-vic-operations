import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail } from "../src/lib/estimate-email";

const sampleUrl = "https://quote.homeinsulationvictoria.com.au/estimate/sample-secure-link";
const email = renderEstimateEmail({ estimateUrl: sampleUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1 });
const noArea = renderEstimateEmail({ estimateUrl: sampleUrl });

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
    for (const body of [email.html, email.plainText]) {
      expect(body).toContain("VIEW &amp; EXPLORE MY ESTIMATE".replace("&amp;", body === email.html ? "&amp;" : "&"));
      for (const copy of ["Your estimate is interactive. You can:", "See your estimated VEU discount and project price", "Change the ceiling-area assumption and see the estimate update", "See what is included and what could change the final price", "Understand the $349 onsite step before deciding to proceed", "Nothing you change in the self-serve calculator changes your recorded property details or final quote.", "Explore your personalised estimate", "You can also test different ceiling-area assumptions yourself."]) expect(body).toContain(copy);
    }
  });

  test("no-area email invites a self-serve estimate without inventing amounts or area", () => {
    expect(noArea.subject).toBe("Good news — your home looks likely to qualify. Calculate your HI VIC estimate");
    expect(noArea.previewText).toBe("Your self-serve HI VIC estimate is ready — enter a rough ceiling area to see your estimated VEU discount and project price.");
    for (const body of [noArea.html, noArea.plainText]) {
      for (const copy of ["CALCULATE &amp; EXPLORE MY ESTIMATE".replace("&amp;", body === noArea.html ? "&amp;" : "&"), "See what your upgrade could cost", "enter a rough area", "Build your self-serve estimate", "The $349 will be included in the indicative project total shown once you enter an area", "$400+ / year*", "Up to 20%*", "Warmer in winter. Cooler in summer.", "EEC Certified Insulation Installer", "Transparent HI VIC pricing", sampleUrl]) expect(body).toContain(copy);
      for (const invented of ["$3,396", "$1,325", "134.1", "already included in your indicative project total"]) expect(body).not.toContain(invented);
    }
  });

  test("rejects partial, invalid, zero and mixed estimate values", () => {
    for (const values of [
      { estimatedTotal: 3396 },
      { estimatedTotal: null, veuDiscount: 1325, areaM2: 134.1 },
      { estimatedTotal: 3396, veuDiscount: 1325 },
      { estimatedTotal: 0, veuDiscount: 1325, areaM2: 134.1 },
      { estimatedTotal: Infinity, veuDiscount: 1325, areaM2: 134.1 },
    ]) expect(() => renderEstimateEmail({ estimateUrl: sampleUrl, ...values })).toThrow();
    expect(renderEstimateEmail({ estimateUrl: sampleUrl, estimatedTotal: null, veuDiscount: undefined, areaM2: null }).html).toContain("See what your upgrade could cost");
  });

  test("is email-safe and contains no delivery or provider integration", () => {
    const source = readFileSync("src/lib/estimate-email.ts", "utf8");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    for (const result of [email, noArea]) {
      expect(result.html).not.toMatch(/<script\b|lovable\.app|class=|<style\b/i);
      expect(result.plainText).not.toContain("lovable.app");
    }
    expect(source + preview).not.toMatch(/sendTemplateEmail|sendLovableEmail|createServerFn|supabase|fetch\(|\.insert\(|\.update\(/);
    expect(preview).toContain('srcDoc={sample.html.replace(');
    expect(preview).toContain("sample-secure-link");
    expect(preview).toContain("No area yet");
  });

  test("rejects external, insecure, and query-bearing links", () => {
    for (const url of ["https://example.com/estimate/token", "http://quote.homeinsulationvictoria.com.au/estimate/token", "https://quote.homeinsulationvictoria.com.au/estimate/token?leak=1"]) {
      expect(() => renderEstimateEmail({ estimateUrl: url, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1 })).toThrow();
    }
  });
});