// Decision 352 (Jo 25 Oct 2026): on our leads the owner's safety-check price is fixed when the quote goes out — a later
// change of electrician never re-prices; we pay whoever does it their own onboarding rate. Since decisions 373/374 the
// our-lead line is always $349 and the electrician is always ours.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { safetyCheckCentsFor } from "../src/lib/safety-check-amount.core";
import { ownerPiesaLineIncGst } from "../src/lib/our-lead-piesa-electrician.core";

const src = (f: string) => readFileSync(`src/lib/${f}`, "utf8");

describe("decision 352: the quoted safety-check price is never re-priced by an electrician change", () => {
  test("the owner's PIESA line is decided ONLY when the installation quote is generated", () => {
    const files = ["allocation.server.ts", "offer-dispatch.functions.ts", "offer-dispatch.server.ts", "auto-offer.server.ts", "piesa-times.server.ts", "jo-tradie.server.ts", "our-lead-piesa-electrician.server.ts"];
    for (const f of files) {
      const s = src(f);
      expect(s, f).not.toContain("generateInstallerQuotes");
      expect(s, f).not.toMatch(/ownerPiesaLineIncGst\(/);
    }
    expect(src("quotes.server.ts")).toContain("ownerPiesaLineIncGst(");
  });
  test("the safety-check payment reads the accepted quote's line, whoever later does the PIESA", () => {
    // Decisions 373/374: our leads always $349 and our electrician; a later change of electrician never re-prices.
    const quoted = ownerPiesaLineIncGst(349);
    expect(quoted).toBe(349);
    const quoteLines = [{ code: "PIESA", line_total_inc_gst: quoted }];
    expect(safetyCheckCentsFor({ lines: quoteLines, settingIncGst: 349 })).toEqual({ cents: 34_900, source: "quote_line" });
  });
  test("office margin and job profit pay the assigned electrician their own rate first", () => {
    expect(src("office-money.server.ts")).toContain("(elec && piesaRate.has(elec) ? piesaRate.get(elec)! : usualPiesaEx ?? fallbackPiesa)");
    expect(readFileSync("src/lib/profit.functions.ts", "utf8")).toContain("electricianPiesaRateInc: piesaRate ?? usualPiesaRate");
  });
});
