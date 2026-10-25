import { describe, expect, test } from "bun:test";
import { contactAnswersFromEntries, flatten } from "../src/lib/mitti.core";
import { resolveMittiElectrician, usualElectrician, MISSING_USUAL_ELECTRICIAN } from "../src/lib/usual-electrician.core";
import { buildMittiInstallerQuote, mittiQuoteElectricalBlocker } from "../src/lib/mitti-installer-quote.core";
import { quotedPriceFromEntries, piesaChargeIncGst } from "../src/lib/installer-led.core";

const base = { price: quotedPriceFromEntries([{ label: "What's included in your quote?", value: "R5.0 supply and install" }, { label: "Total quoted price (inc GST)", value: "2400" }], false), measuredM2: 100, wholeVeec: { veecs: 20, raw: 1400 }, caps: { metropolitan: true, minCopay: 200 } };
const different = { name: "TEST Different REC", licence: "TEST-LIC-02", priceIncGst: "$450.50" };
const usual = { name: "TEST Usual REC", licence: "TEST-LIC-01", priceIncGst: 275 };
describe("Jo's three Mitti electrician options", () => {
  test("Home Insulation Victoria electrician costs $349 plus $349 fee minus rebate", () => {
    const r = resolveMittiElectrician({ choice: "hivic", usual, different });
    const d = buildMittiInstallerQuote(base, r);
    expect(r.priceIncGst).toBe(349); expect(d.ready).toBe(true);
    expect(d.subtotal).toBe(3098); expect(d.discount).toBe(1400); expect(d.afterDiscount).toBe(1698);
    expect(mittiQuoteElectricalBlocker(d.lines, r, r)).toBeNull();
  });
  test("My usual electrician uses saved $275, not hidden form price, and retains identity", () => {
    const r = resolveMittiElectrician({ choice: "usual", usual, different });
    const d = buildMittiInstallerQuote(base, r);
    expect(r).toMatchObject({ name: "TEST Usual REC", licence: "TEST-LIC-01", priceIncGst: 275, source: "installer_profile" });
    expect(d.ready).toBe(true); expect(d.subtotal).toBe(3024); expect(d.afterDiscount).toBe(1624);
  });
  test("A different electrician uses form $450.50 and form identity", () => {
    const r = resolveMittiElectrician({ choice: "different", usual, different });
    const d = buildMittiInstallerQuote(base, r);
    expect(r).toMatchObject({ name: "TEST Different REC", licence: "TEST-LIC-02", priceIncGst: 450.5, source: "mitti_form" });
    expect(d.ready).toBe(true); expect(d.subtotal).toBe(3199.5); expect(d.afterDiscount).toBe(1799.5);
  });
  test("missing usual profile holds, requests profile and never substitutes form or $349", () => {
    const r = resolveMittiElectrician({ choice: "usual", usual: null, different });
    expect(r).toMatchObject({ ready: false, needsProfile: true, priceIncGst: null, reasons: [MISSING_USUAL_ELECTRICIAN] });
    const d = buildMittiInstallerQuote(base, r);
    expect(d.ready).toBe(false); expect(d.blockers).toContain("Installer has no usual electrician saved");
  });
  test("invalid/partial different details hold", () => {
    for (const input of [{ ...different, licence: "" }, { ...different, priceIncGst: "not known" }, { ...different, priceIncGst: "-1" }]) {
      expect(resolveMittiElectrician({ choice: "different", usual, different: input }).ready).toBe(false);
    }
  });
  test("saved zero is explicit, blank/negative/infinite is not a price", () => {
    expect(usualElectrician({ ...usual, priceIncGst: 0 })?.priceIncGst).toBe(0);
    for (const priceIncGst of [-1, Infinity, NaN]) expect(usualElectrician({ ...usual, priceIncGst })).toBeNull();
    // Decision 369: a blank price is simply no price (My business no longer asks for one).
    expect(usualElectrician({ ...usual, priceIncGst: "" })?.priceIncGst).toBeUndefined();
  });
  test("all three exact choices parse; unrecognised remains undecided", () => {
    for (const [label, result] of [["Home Insulation Victoria electrician", "hivic"], ["My usual electrician", "usual"], ["A different electrician", "different"], ["maybe", null]]) {
      expect(contactAnswersFromEntries([{ label: "Who is doing the electrical safety check?", value: label }]).electricianChoice).toBe(result);
    }
  });
  test("native phone response reads phone value", () => {
    const entries = flatten({ items: [{ id: "phone", label: "Homeowner phone", phone: {}, responses: { phone_number: "0400000000" } }] });
    expect(contactAnswersFromEntries(entries).phone).toBe("0400000000");
  });
  test("changed electrical identity or price blocks release; extra audit metadata does not", () => {
    const r = resolveMittiElectrician({ choice: "usual", usual, different });
    const d = buildMittiInstallerQuote(base, r);
    expect(mittiQuoteElectricalBlocker(d.lines, r, { ...r, name: "Another REC" })).not.toBeNull();
    expect(mittiQuoteElectricalBlocker(d.lines, r, { ...r, priceIncGst: 300 })).not.toBeNull();
    expect(mittiQuoteElectricalBlocker(d.lines, r, { ...r })).toBeNull();
    expect(mittiQuoteElectricalBlocker(d.lines.map((l) => l.code === "AP_FEE" ? { ...l, line_total_inc_gst: 348 } : l), r, r)).not.toBeNull();
  });
  test("legacy own electrician still direct-billed outside new Mitti pathway", () => {
    expect(piesaChargeIncGst("installer_own", 349)).toBe(0);
    expect(piesaChargeIncGst("hivic_organise", 349)).toBe(349);
  });
});