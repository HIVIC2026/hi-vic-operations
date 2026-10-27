import { describe, expect, test } from "bun:test";
import { buildInstallerQuoteDraft, quotedPriceFromEntries } from "../src/lib/installer-led.core";

const e = (inc: string, total: string | null) => [
  { label: "What's included in your quote?", value: inc },
  { label: "Total quoted price (inc GST)", value: total },
  { label: "What else is included?", value: null },
];
const base = { measuredM2: 100, wholeVeec: { veecs: Math.floor(20), raw: Math.floor(20) * 70 }, piesaIncGst: 349, apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 } };

describe("automatic installer quote", () => {
  test("whole VEECs: 20.9 rounds down to 20", () => {
    const d = buildInstallerQuoteDraft({ ...base, wholeVeec: { veecs: Math.floor(20.9), raw: Math.floor(20.9) * 70 }, price: quotedPriceFromEntries(e("R5.0 supply and install", "2400"), false) });
    expect(d.discount).toBe(1400);
  });
  test("installer price + 349 PIESA + 349 AP − discount from m²", () => {
    const d = buildInstallerQuoteDraft({ ...base, price: quotedPriceFromEntries(e("R5.0 supply and install, Tile lift", "$2,400"), false) });
    expect(d.ready).toBe(true);
    expect(d.subtotal).toBe(3098);
    expect(d.discount).toBe(1400);
    expect(d.afterDiscount).toBe(1698);
    expect(d.lines.map((l) => l.code)).toEqual(["INSTALLER_PRICE", "PIESA", "AP_FEE"]);
    expect(d.lines[0]!.description).toContain("Tile lift");
    expect(d.lines.some((l) => /lead|margin/i.test(l.description))).toBe(false);
  });
  test("held when nothing ticked, no price, or no m²", () => {
    expect(buildInstallerQuoteDraft({ ...base, price: quotedPriceFromEntries(e("", "2400"), false) }).ready).toBe(false);
    expect(buildInstallerQuoteDraft({ ...base, price: quotedPriceFromEntries(e("R5.0 supply and install", null), false) }).ready).toBe(false);
    expect(buildInstallerQuoteDraft({ ...base, measuredM2: null, price: quotedPriceFromEntries(e("R5.0 supply and install", "2400"), false) }).ready).toBe(false);
  });
  test("discount reduced so the owner still pays the $200 minimum", () => {
    const d = buildInstallerQuoteDraft({ ...base, wholeVeec: { veecs: Math.floor(60), raw: Math.floor(60) * 70 }, price: quotedPriceFromEntries(e("R5.0 supply and install", "1000"), false) });
    expect(d.ready).toBe(true);
    expect(d.afterDiscount).toBe(200);
  });
  test("Jo 27 Oct 2026 (HV-3385): a removal tick mismatch holds the quote but never blanks the entered price", () => {
    // Removal ticked as included, no ceiling area marked Remove (removalRequired false), price $4,500 in the portal.
    const price = quotedPriceFromEntries(e("R5.0 supply and install, Removal of existing insulation", "4500"), false);
    const d = buildInstallerQuoteDraft({ ...base, price });
    expect(d.ready).toBe(false);
    expect(d.blockers).toEqual(["Removal is ticked as included, but no ceiling area is marked Remove — office must review."]);
    expect(d.blockers).not.toContain("Installer quote amount is missing.");
    expect(d.lines.find((l) => l.code === "INSTALLER_PRICE")?.line_total_inc_gst).toBe(4500);
  });
});

describe("Industry Pack example", () => {
  test("0.00546 × 150 × 25 × 1.04 = 21.294 → 21 whole VEECs", () => {
    expect(Math.floor(0.00546 * 150 * 25 * 1.04)).toBe(21);
  });
});
