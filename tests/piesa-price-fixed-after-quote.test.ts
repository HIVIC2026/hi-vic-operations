// Decision 352 (Jo 25 Oct 2026): on our leads the owner's safety-check price is fixed when the quote goes out. If the
// installer's usual electrician later can't do it and our electrician does, the quoted price STAYS (no re-price, no
// message); we pay whoever does it their own onboarding rate.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { safetyCheckCentsFor } from "../src/lib/safety-check-amount.core";
import { ourLeadPiesaElectrician, ownerPiesaLineIncGst, piesaPayableRate } from "../src/lib/our-lead-piesa-electrician.core";
import { usualElectrician } from "../src/lib/usual-electrician.core";

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
    const usual = usualElectrician({ name: "Sparkie Co", licence: "REC 12345", priceIncGst: 220 })!;
    const before = [{ business_id: "rec-sparkie", name: "Sparkie Co", rec_number: "REC-12345", piesa_rate: { id: "r-s", rate_inc_gst: 220 } }];
    const quoted = ownerPiesaLineIncGst(349, ourLeadPiesaElectrician({ channel: "website", usual, candidates: before }));
    expect(quoted).toBe(349); // decision 373: our leads always $349
    const quoteLines = [{ code: "PIESA", line_total_inc_gst: quoted }];
    // Later the usual electrician is blocked; a fresh selection would say "ours" ($349) — but the quote line is what counts.
    const later = ourLeadPiesaElectrician({ channel: "website", usual, candidates: before.map((c) => ({ ...c, blocker: "Not taking jobs." })) });
    expect(ownerPiesaLineIncGst(349, later)).toBe(349);
    expect(safetyCheckCentsFor({ lines: quoteLines, settingIncGst: 349 })).toEqual({ cents: 34_900, source: "quote_line" });
    // We pay our electrician their own agreed onboarding rate, not the owner's $220.
    expect(piesaPayableRate(later, "rec-ours", { id: "rate-ours", rate: 260 })).toEqual({ id: "rate-ours", rate: 260, source: "agreed_rate" });
  });
  test("office margin and job profit pay the assigned electrician their own rate first", () => {
    expect(src("office-money.server.ts")).toContain("(elec && piesaRate.has(elec) ? piesaRate.get(elec)! : usualPiesaEx ?? fallbackPiesa)");
    expect(readFileSync("src/lib/profit.functions.ts", "utf8")).toContain("electricianPiesaRateInc: piesaRate ?? usualPiesaRate");
  });
});
