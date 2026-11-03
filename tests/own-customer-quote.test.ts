import { describe, expect, test } from "bun:test";
import { buildMittiInstallerQuote, mittiQuoteElectricalBlocker } from "../src/lib/mitti-installer-quote.core";
import { buildInstallerQuoteDraft } from "../src/lib/installer-led.core";
import { OWN_CUSTOMER_LABELS, OWN_CUSTOMER_PIESA_INC_GST } from "../src/lib/own-customer-price.core";
import { resolveMittiElectrician, type MittiElectricianResolution } from "../src/lib/usual-electrician.core";
import { WORKFLOW_DECISIONS } from "../src/config/workflow-decisions";

// Part 10 Task 2 — own customers (channel installer_sourced, Ready Check A1): owner's price = installer's price + $349
// Home Insulation Victoria fee + $349 PIESA − rebate (Jo 2 Nov 2026, "FEES … CORRECTION"). The PIESA line is $349
// whatever the electrician's own rate; the electrician is still paid their rate.

const baseInput = {
  price: { ok: true, issues: [], price: { totalIncGst: 2000, included: ["R5.0 supply and install"], otherDescription: "", agreedWithOwner: false } },
  measuredM2: 120,
  wholeVeec: { veecs: 10, raw: 600 },
  caps: { metropolitan: true, minCopay: 200 },
};
const readyElectrician: MittiElectricianResolution = { ready: true, choice: "usual", priceIncGst: 275, name: "Volt Right Electrical", licence: "REC-99001", source: "approved_rec", reasons: [], needsProfile: false };
const notOnboarded: MittiElectricianResolution = { ready: false, choice: "usual", priceIncGst: null, name: "ornaldo", licence: "A123212", source: "approved_rec", reasons: ["Electrician not onboarded: ornaldo"], needsProfile: false };
const sortedCodes = (d: { lines: { code: string; sort: number }[] }) => [...d.lines].sort((a, b) => a.sort - b.sort).map((l) => l.code);

describe("own-customer quote: $349 fee + $349 PIESA, approved line names and order", () => {
  for (const rate of [275, 349, 420]) {
    test(`PIESA line is $349 when the electrician charges $${rate}`, () => {
      const d = buildMittiInstallerQuote(baseInput, { ...readyElectrician, priceIncGst: rate });
      const piesa = d.lines.filter((l) => l.code === "PIESA");
      expect(piesa.map((l) => [l.description, l.line_total_inc_gst])).toEqual([["Electrical safety check (PIESA)", 349]]);
      expect(d.lines.find((l) => l.code === "AP_FEE")).toMatchObject({ description: "Home Insulation Victoria fee", line_total_inc_gst: 349 });
      expect(d.subtotal).toBe(2698);
      expect(d.afterDiscount).toBe(2098);
      expect(d.ready).toBe(true);
    });
  }

  test("fee before PIESA, insulation first — by sort and in the array", () => {
    const d = buildMittiInstallerQuote(baseInput, readyElectrician);
    expect(sortedCodes(d)).toEqual(["INSTALLER_PRICE", "AP_FEE", "PIESA"]);
    expect(d.lines.map((l) => l.code)).toEqual(["INSTALLER_PRICE", "AP_FEE", "PIESA"]);
    expect(d.lines.map((l) => l.sort)).toEqual([0, 1, 2]);
  });

  test("separately agreed extras stay between Insulation and the fee", () => {
    const d = buildMittiInstallerQuote({ ...baseInput, separateLines: [{ code: "INSTALLER_REMOVAL", description: "Removal of existing insulation (40 m²) — agreed additional price", amountIncGst: 300 }] }, readyElectrician);
    expect(sortedCodes(d)).toEqual(["INSTALLER_PRICE", "INSTALLER_REMOVAL", "AP_FEE", "PIESA"]);
    expect(d.subtotal).toBe(2998);
  });

  test("line descriptions are the approved labels; unit price matches the line total", () => {
    const d = buildMittiInstallerQuote(baseInput, readyElectrician);
    const fee = d.lines.find((l) => l.code === "AP_FEE")!;
    const piesa = d.lines.find((l) => l.code === "PIESA")!;
    expect(fee.description).toBe(OWN_CUSTOMER_LABELS.apFee);
    expect(piesa.description).toBe(OWN_CUSTOMER_LABELS.piesa);
    expect(fee.unit_price_inc_gst).toBe(349);
    expect(piesa.unit_price_inc_gst).toBe(OWN_CUSTOMER_PIESA_INC_GST);
    expect(piesa.explanation).toBeNull(); // the server adds the electrician's name later; never the rate
  });

  test("the electrician's own rate never appears on any owner line", () => {
    const d = buildMittiInstallerQuote(baseInput, { ...readyElectrician, priceIncGst: 275 });
    expect(JSON.stringify(d.lines)).not.toContain("275");
  });

  test("Home Insulation Victoria's electrician at the setting price (355) still shows $349 to the owner", () => {
    const hiv = resolveMittiElectrician({ choice: "hivic", usual: null, different: { name: null, licence: null, priceIncGst: null }, standardPiesaIncGst: 355 });
    const d = buildMittiInstallerQuote(baseInput, hiv);
    expect(d.lines.find((l) => l.code === "PIESA")!.line_total_inc_gst).toBe(349);
    expect(d.subtotal).toBe(2698);
  });

  test("not-onboarded electrician still holds the quote", () => {
    const d = buildMittiInstallerQuote(baseInput, notOnboarded);
    expect(d.ready).toBe(false);
    expect(d.blockers).toContain(notOnboarded.reasons[0]!);
    // the lines are still the approved ones, so a later re-check sees the $349 PIESA
    expect(d.lines.find((l) => l.code === "PIESA")!.line_total_inc_gst).toBe(349);
  });

  test("$200 minimum co-payment still applies", () => {
    const d = buildMittiInstallerQuote({ ...baseInput, wholeVeec: { veecs: 40, raw: 2600 } }, readyElectrician);
    expect(d.subtotal).toBe(2698);
    expect(d.afterDiscount).toBe(200);
    expect(d.discount).toBe(2498);
  });
});

describe("release check (mittiQuoteElectricalBlocker)", () => {
  const saved = { ...readyElectrician, priceIncGst: 275 };
  const current = { ...readyElectrician, priceIncGst: 275 };
  const linesOf = (d: { lines: { code: string; line_total_inc_gst: number }[] }) => d.lines.map((l) => ({ code: l.code, line_total_inc_gst: l.line_total_inc_gst }));

  test("a $349 PIESA line is not held as 'price does not match' when the electrician charges $275", () => {
    expect(mittiQuoteElectricalBlocker(linesOf(buildMittiInstallerQuote(baseInput, saved)), saved, current)).toBeNull();
  });

  test("old draft with the electrician's $275 PIESA holds and never goes out at the old amount", () => {
    expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 275 }], saved, current)).toBe("Ready Check quote electrician price does not match the recorded choice");
  });

  test("a draft with no PIESA line, two PIESA lines, or a string amount other than 349 holds", () => {
    expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: 349 }], saved, current)).toBe("Ready Check quote electrician price does not match the recorded choice");
    expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 349 }], saved, current)).toBe("Ready Check quote electrician price does not match the recorded choice");
    expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: "349.00" }, { code: "PIESA", line_total_inc_gst: "349.00" }], saved, current)).toBeNull();
    expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: "349.00" }, { code: "PIESA", line_total_inc_gst: "220.00" }], saved, current)).toBe("Ready Check quote electrician price does not match the recorded choice");
  });

  test("a saved $0 electrician no longer excuses a missing PIESA line", () => {
    const zero = { ...readyElectrician, priceIncGst: 0 };
    expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: 349 }], zero, zero)).toBe("Ready Check quote electrician price does not match the recorded choice");
    expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 349 }], zero, zero)).toBeNull();
  });

  test("the fee check and the identity/rate-changed check are unchanged", () => {
    const good = [{ code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: 349 }];
    expect(mittiQuoteElectricalBlocker([{ code: "AP_FEE", line_total_inc_gst: 348 }, { code: "PIESA", line_total_inc_gst: 349 }], saved, current)).toBe("Ready Check quote must include the $349 Home Insulation Victoria fee");
    expect(mittiQuoteElectricalBlocker(good, saved, { ...current, name: "Another REC" })).toBe("Ready Check electrician details changed or are incomplete — prepare a new quote");
    expect(mittiQuoteElectricalBlocker(good, saved, { ...current, priceIncGst: 300 })).toBe("Ready Check electrician details changed or are incomplete — prepare a new quote");
    expect(mittiQuoteElectricalBlocker(good, saved, null)).toBe("Ready Check electrician details changed or are incomplete — prepare a new quote");
  });
});

describe("Home Insulation Victoria leads are untouched", () => {
  test("buildInstallerQuoteDraft (the shared builder) output is byte-identical to the base commit", () => {
    const recordedAtBase =
      '{"ready":true,"blockers":[],"lines":[{"code":"INSTALLER_PRICE","description":"Insulation works by your installer — includes: Supply, Install","quantity":1,"unit":"flat","unit_price_inc_gst":2000,"line_total_inc_gst":2000,"is_other":false,"explanation":"Supply\\nInstall","sort":0},{"code":"PIESA","description":"Mandatory Pre Insulation Electrical Safety Assessment (PIESA)","quantity":1,"unit":"flat","unit_price_inc_gst":349,"line_total_inc_gst":349,"is_other":false,"explanation":null,"sort":1},{"code":"AP_FEE","description":"Home Insulation Victoria — Accredited Person fee","quantity":1,"unit":"flat","unit_price_inc_gst":349,"line_total_inc_gst":349,"is_other":false,"explanation":null,"sort":2}],"subtotal":2698,"discount":600,"afterDiscount":2098,"discountNote":null}';
    const out = buildInstallerQuoteDraft({
      price: { ok: true, issues: [], price: { totalIncGst: 2000, included: ["Supply", "Install"], otherDescription: "", agreedWithOwner: true } },
      measuredM2: 120, wholeVeec: { veecs: 10, raw: 600 }, piesaIncGst: 349, apFeeIncGst: 349, caps: { metropolitan: true, minCopay: 200 }, separateLines: [],
    });
    expect(JSON.stringify(out)).toBe(recordedAtBase);
  });

  test("the Home Insulation Victoria lead quote (hiv-quote.core priceHivQuote) is byte-identical to the base commit", async () => {
    // Recorded at 1b7dcca. A2 / our leads never go through buildMittiInstallerQuote; their PIESA and fee lines keep the old wording.
    const { priceHivQuote } = await import("../src/lib/hiv-quote.core");
    const recordedAtBase =
      '{"lines":[{"code":"R5_BATTS","description":"R5.0 ceiling insulation supply & install","quantity":100,"unit":"m2","unit_price_inc_gst":20,"line_total_inc_gst":2000,"is_other":false,"explanation":null,"sort":0},{"code":"PIESA","description":"Mandatory Pre Insulation Electrical Safety Assessment (PIESA)","quantity":1,"unit":"flat","unit_price_inc_gst":349,"line_total_inc_gst":349,"is_other":false,"explanation":null,"sort":1},{"code":"AP_FEE","description":"Accredited Person fee (Home Insulation Victoria)","quantity":1,"unit":"flat","unit_price_inc_gst":349,"line_total_inc_gst":349,"is_other":false,"explanation":null,"sort":2}],"rValue":"R5.0","holdReasons":[],"difficultAccess":null,"installerMarkup":{"r5MarkupInc":900,"removalMarkupInc":0,"travelInc":0,"markupInc":900,"markupEx":818.18,"ownerR5IncPerM2":20,"installerR5IncPerM2":11,"installerRemovalIncPerM2":0},"installerCostEx":1000}';
    const out = priceHivQuote({ areaM2: 100, removalM2: 0, gstRate: 0.1, installerR5ExPerM2: 10, ownerR5IncPerM2: 20, ownerRemovalIncPerM2: 15, installerRemovalExPerM2: null, piesaIncGst: 349, apFeeIncGst: 349 });
    expect(JSON.stringify(out)).toBe(recordedAtBase);
  });

  test("workflow decisions record the 2 Nov fee rule for own customers only", () => {
    const own = WORKFLOW_DECISIONS.routes.installer_supplied.ownCustomerFees;
    expect(own).toMatchObject({ apFeeIncGst: 349, piesaIncGst: 349, decided: "2026-11-02" });
    expect(own.lineLabels).toEqual(["Insulation", "Home Insulation Victoria fee", "Electrical safety check (PIESA)", "Rebate", "Your price"]);
    expect(WORKFLOW_DECISIONS.routes.hiv_lead).toEqual({
      paymentRule: "hiv_confirmed_quote_rule",
      leadFee: "none",
      ownerPrice: "fixed_owner_prices_markup_is_owner_price_minus_installer_agreed_rate_inc_gst",
    });
  });
});

// Task 3 follow-up (Task 2 review, judgement 4): the non-Mitti fallback branch of draftInstallerQuoteFromReadyCheck
// (intake price, no electrician resolution) prices the SAME $349 fee + $349 PIESA lines with the approved labels and order.
describe("own-customer draft without a Mitti electrician (intake fallback) — same lines as the Ready Check path", () => {
  test("buildOwnCustomerQuoteDraft: $349 fee + $349 PIESA, approved labels, Insulation · fee · PIESA order", async () => {
    const { buildOwnCustomerQuoteDraft } = await import("../src/lib/mitti-installer-quote.core");
    const d = buildOwnCustomerQuoteDraft(baseInput);
    expect(d.lines.map((l) => [l.code, l.description, l.line_total_inc_gst, l.sort])).toEqual([
      ["INSTALLER_PRICE", "Insulation works by your installer — includes: R5.0 supply and install", 2000, 0],
      ["AP_FEE", OWN_CUSTOMER_LABELS.apFee, 349, 1],
      ["PIESA", OWN_CUSTOMER_LABELS.piesa, OWN_CUSTOMER_PIESA_INC_GST, 2],
    ]);
    expect(d.subtotal).toBe(2698);
    expect(d.afterDiscount).toBe(2098);
    expect(d.ready).toBe(true);
    expect(d.blockers).toEqual([]);
  });

  test("the Ready Check path is the same draft plus the electrician's hold reasons", async () => {
    const { buildOwnCustomerQuoteDraft } = await import("../src/lib/mitti-installer-quote.core");
    const plain = buildOwnCustomerQuoteDraft(baseInput);
    const withElectrician = buildMittiInstallerQuote(baseInput, readyElectrician);
    expect(JSON.stringify(withElectrician)).toBe(JSON.stringify(plain));
    const held = buildMittiInstallerQuote(baseInput, notOnboarded);
    expect(held.lines).toEqual(plain.lines);
    expect(held.blockers).toEqual([...plain.blockers, ...notOnboarded.reasons]);
    expect(held.ready).toBe(false);
  });

  test("separately agreed extras sit between Insulation and the fee on the fallback too", async () => {
    const { buildOwnCustomerQuoteDraft } = await import("../src/lib/mitti-installer-quote.core");
    const d = buildOwnCustomerQuoteDraft({ ...baseInput, separateLines: [{ code: "INSTALLER_EXTRA", description: "Extra hatch", amountIncGst: 150 }] });
    expect(sortedCodes(d)).toEqual(["INSTALLER_PRICE", "INSTALLER_EXTRA", "AP_FEE", "PIESA"]);
    expect(d.subtotal).toBe(2848);
  });

  test("installer-quote.server: the non-Mitti branch calls buildOwnCustomerQuoteDraft, never the shared builder, and no longer reads piesaChargeIncGst", async () => {
    const src = await Bun.file(new URL("../src/lib/installer-quote.server.ts", import.meta.url)).text();
    const fn = src.slice(src.indexOf("export async function draftInstallerQuoteFromReadyCheck"));
    expect(fn).toContain("buildOwnCustomerQuoteDraft(draftInput)");
    expect(fn).not.toMatch(/\bbuildInstallerQuoteDraft\(/);
    expect(fn).not.toContain("piesaChargeIncGst(");
  });
});

// Final review M2: the legacy intake release check (electricalLineBlocker, used by quoteBillingBlocker when no Mitti snapshot
// exists) also checks the amounts — exactly one AP_FEE at $349 and one PIESA at $349 — so an old $275 intake draft holds.
describe("M2: electricalLineBlocker checks the $349 amounts", () => {
  test("$349 + $349 passes; a $275 PIESA, a $200 fee, a missing fee or a doubled line holds", async () => {
    const { electricalLineBlocker } = await import("../src/lib/installer-intake.core");
    const ok = [{ code: "INSTALLER_PRICE", line_total_inc_gst: 2000 }, { code: "AP_FEE", line_total_inc_gst: 349 }, { code: "PIESA", line_total_inc_gst: "349.00" }];
    expect(electricalLineBlocker(ok, "hivic")).toBeNull();
    expect(electricalLineBlocker(ok, "own")).toBeNull();
    expect(electricalLineBlocker([ok[0]!, ok[1]!, { code: "PIESA", line_total_inc_gst: 275 }], "own")).toBe("This quote's electrical safety check (PIESA) line is $275.00, not $349 — prepare a fresh quote first");
    expect(electricalLineBlocker([ok[0]!, { code: "AP_FEE", line_total_inc_gst: 200 }, ok[2]!], "hivic")).toBe("This quote's Home Insulation Victoria fee line is $200.00, not $349 — prepare a fresh quote first");
    expect(electricalLineBlocker([ok[0]!, ok[2]!], "hivic")).toBe("This quote has no Home Insulation Victoria fee line — prepare a fresh quote first");
    expect(electricalLineBlocker([...ok, ok[2]!], "hivic")).toBe("This quote's electrical safety check (PIESA) line is doubled — prepare a fresh quote first");
    // the old reasons are kept
    expect(electricalLineBlocker([ok[0]!, ok[1]!], "hivic")).toBe("This quote has no PIESA line but Home Insulation Victoria is arranging the electrician — prepare a fresh quote first");
    expect(electricalLineBlocker([ok[0]!, ok[1]!], "own")).toBe("This quote has no electrical safety check (PIESA) line for the installer's electrician — prepare a fresh quote first");
    expect(electricalLineBlocker(ok, "undecided")).toBe("Electrician arrangement not decided yet — this quote can't go to the owner");
    // plain codes (old callers) still work for the presence checks
    expect(electricalLineBlocker(["INSTALLER_PRICE", "AP_FEE", "PIESA"], "hivic")).toBeNull();
  });
});

describe("M1: the office invoice preview shows the quote's own fee and PIESA lines", () => {
  test("installer-invoice.functions reads AP_FEE / PIESA amounts from the quote lines first, settings only as the fallback", () => {
    const src = require("node:fs").readFileSync("src/lib/installer-invoice.functions.ts", "utf8") as string;
    expect(src).toContain('const apFee = lineAmount("AP_FEE") ?? override ?? standardApFee;');
    expect(src).toContain('const piesa = lineAmount("PIESA") ?? piesaChargeIncGst(');
  });
});
