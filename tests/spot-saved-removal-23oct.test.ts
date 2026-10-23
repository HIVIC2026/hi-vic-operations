import { describe, expect, test } from "bun:test";
import { renderSpotSavedEmail, SPOT_SAVED_NOT_INCLUDED } from "../src/lib/spot-saved-messages.core";
import { renderPreliminarySpotSavedEmail } from "../src/lib/preliminary-save-spot.core";
import { REMOVAL_BUDGET_EMAIL_NOTE } from "../src/lib/estimate-removal.core";

const base = { firstName: "Ann", rebate: 1400, suburb: "Ballarat", shortAddress: "1 A St, Ballarat", myJobUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/tok", optOutUrl: "https://x/o",
  estimate: { gross: 6698, customer: 5298, areaM2: 150, address: "1 A St, Ballarat VIC 3350", calculatorUrl: "https://x/c" } };
const plainHtml = (h: string) => h.replace(/&#39;|&rsquo;/g, "’");

describe("Spot saved email removal (Jo 23 Oct)", () => {
  test("included: removal line in price box + note, html and text", () => {
    const e = renderSpotSavedEmail({ ...base, removal: { kind: "included", amount: 1500, areaM2: 100 } });
    for (const s of [e.html, e.text]) { expect(s).toContain("Removal of existing insulation"); expect(s).toContain("100 m² included in this estimate; scope confirmed at your free Ready Check."); expect(s).toContain("This estimate includes $1,500 inc GST for removal of 100 m²"); }
  });
  test("unknown: budget note, no removal line", () => {
    const e = renderSpotSavedEmail({ ...base, removal: { kind: "unknown" } });
    expect(e.text).toContain(REMOVAL_BUDGET_EMAIL_NOTE);
    expect(plainHtml(e.html)).toContain("Please budget $15 per m²");
    expect(e.text).not.toContain("Removal of existing insulation:");
  });
  test("excluded: nothing about removal", () => {
    const e = renderSpotSavedEmail({ ...base, removal: { kind: "excluded" } });
    expect(e.text).not.toMatch(/removal|removed/i);
    expect(e.html).not.toMatch(/budget \$15/);
  });
  test("electrical-fix sentence for everyone, html and text", () => {
    for (const r of [null, { kind: "excluded" as const }]) {
      const e = renderSpotSavedEmail({ ...base, removal: r });
      expect(e.text).toContain(SPOT_SAVED_NOT_INCLUDED);
      expect(plainHtml(e.html)).toContain("that work is extra and will be quoted separately.");
    }
  });
});

describe("Version 2 (no estimate)", () => {
  const v2 = () => renderPreliminarySpotSavedEmail({ firstName: "Vic", myJobUrl: null });
  test("Jo 23 Oct correction: never prices or m² – no removal budget note", () => {
    const e = v2();
    expect(e.text).not.toContain(REMOVAL_BUDGET_EMAIL_NOTE);
    expect(e.text).not.toMatch(/budget|removal|removed/i);
    expect(e.html).not.toMatch(/\$|m²/);
    expect(e.text).not.toMatch(/\$|m²/);
  });
  test("electrical-fix sentence for everyone", () => {
    const e = v2(); expect(e.text).toContain(SPOT_SAVED_NOT_INCLUDED); expect(plainHtml(e.html)).toContain("will be quoted separately.");
  });
});
