import { describe, expect, test } from "bun:test";
import { buildInstallerQuoteDraft, quotedPriceFromEntries } from "../src/lib/installer-led.core";

const e = (inc: string, total: string | null, agreed = "Yes") => [
  { label: "What's included in your price (tick all that apply)", value: inc },
  { label: "Total quoted price $", value: total },
  { label: "Price already agreed with the owner?", value: agreed },
];
const base = { measuredM2: 100, ghgReduction: 20, veecValue: 70, piesaIncGst: 349, apFeeIncGst: 349 };

describe("automatic installer quote", () => {
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
  test("held below $200 co-payment", () => {
    const d = buildInstallerQuoteDraft({ ...base, ghgReduction: 60, price: quotedPriceFromEntries(e("R5.0 supply and install", "1000"), false) });
    expect(d.ready).toBe(false);
  });
});
