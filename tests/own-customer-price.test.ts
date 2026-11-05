import { describe, expect, test } from "bun:test";
import { OWN_CUSTOMER_AP_FEE_INC_GST, OWN_CUSTOMER_LABELS, PIESA_PRICE_NOT_SET, ownCustomerRows } from "../src/lib/own-customer-price.core";
import { MITTI_INSTALLER_FEE_INC_GST } from "../src/lib/usual-electrician.core";
import { buildInstallerQuoteDraft } from "../src/lib/installer-led.core";

// Part 10 Task 1 — own-customer quote/invoice lines (plan: Insulation · Home Insulation Victoria fee ·
// Electrical safety check (PIESA) · Rebate · Your price). Pure; built from quote_items.code, never the description.
// Jo 4 Nov 2026: the PIESA line is the installer's own PIESA rate (Rapid $275 here), shown as the quote carries it.

const items = [
  { code: "PIESA", description: "x", line_total_inc_gst: 275 },
  { code: "INSTALLER_PRICE", description: "Bradford Gold R5.0 · 120 m²", line_total_inc_gst: 2000 },
  { code: "AP_FEE", description: "y", line_total_inc_gst: 349 },
];

describe("ownCustomerRows", () => {
  test("approved order and labels, whatever order the items arrive in", () => {
    const r = ownCustomerRows(items, 600, 2024);
    expect(r.map((x) => [x.label, x.amountIncGst])).toEqual([
      ["Insulation", 2000],
      ["Home Insulation Victoria fee", 349],
      ["Electrical safety check (PIESA) — charged by Home Insulation Victoria", 275],
      ["Rebate", -600],
      ["Your price", 2024],
    ]);
    expect(r.map((x) => x.key)).toEqual(["insulation", "apFee", "piesa", "rebate", "total"]);
    expect(r[0]!.detail).toBe("Bradford Gold R5.0 · 120 m²");
    // Fee rows are classified by code: their stored description is never shown as the detail (Review Focus 1).
    expect(r[1]!.detail).toBeNull();
    expect(r[2]!.detail).toBeNull();
    expect(r[3]!.detail).toBeNull();
    expect(r[4]!.detail).toBeNull();
  });

  test("separately agreed extras sit under Insulation with their own words", () => {
    const r = ownCustomerRows(
      [...items, { code: "INSTALLER_REMOVAL", description: "Removal of existing insulation – 40 m²", line_total_inc_gst: 300 }],
      600,
      2324,
    );
    expect(r[1]).toEqual({ key: "extra", label: "Removal of existing insulation – 40 m²", detail: null, amountIncGst: 300 });
    expect(r.map((x) => x.key)).toEqual(["insulation", "extra", "apFee", "piesa", "rebate", "total"]);
  });

  test("INSTALLER_EXTRA is an extra too, in the order given", () => {
    const r = ownCustomerRows(
      [
        { code: "INSTALLER_EXTRA", description: "Extra hatch", line_total_inc_gst: 150 },
        { code: "INSTALLER_REMOVAL", description: "Removal of existing insulation – 40 m²", line_total_inc_gst: 300 },
        ...items,
      ],
      600,
      2474,
    );
    expect(r.map((x) => [x.key, x.label])).toEqual([
      ["insulation", "Insulation"],
      ["extra", "Extra hatch"],
      ["extra", "Removal of existing insulation – 40 m²"],
      ["apFee", "Home Insulation Victoria fee"],
      ["piesa", "Electrical safety check (PIESA) — charged by Home Insulation Victoria"],
      ["rebate", "Rebate"],
      ["total", "Your price"],
    ]);
  });

  // I1 (final review) + Jo 4 Nov 2026: never re-price. The PIESA row shows whatever the quote carries — the installer's
  // rate at the time ($349 for Deep, $275 for Rapid, $420 for someone else); a $0 PIESA or any fee other than $349 is
  // NOT an approved own-customer quote — the rows throw and every caller falls back to the generic rows.
  test("the PIESA row is the quote's own amount — $349, $275 or $420 — never re-priced to a constant", () => {
    for (const rate of [349, 275, 420]) {
      const r = ownCustomerRows([...items.filter((i) => i.code !== "PIESA"), { code: "PIESA", description: "x", line_total_inc_gst: rate }], 600, 1749 + rate);
      expect(r.find((x) => x.key === "piesa")!.amountIncGst).toBe(rate);
    }
    expect(() => ownCustomerRows([...items.filter((i) => i.code !== "PIESA"), { code: "PIESA", description: "x", line_total_inc_gst: 0 }], 600, 1749)).toThrow("Own-customer quote PIESA line is $0.00, not a price");
  });

  test("a fee line other than $349 throws", () => {
    expect(() => ownCustomerRows([...items.filter((i) => i.code !== "AP_FEE"), { code: "AP_FEE", description: "y", line_total_inc_gst: 200 }], 600, 1875)).toThrow("Own-customer quote AP_FEE line is $200.00, not $349.00");
  });

  test("rows that don't add up to the quote total (±1c) throw; a cent of rounding is fine", () => {
    expect(() => ownCustomerRows(items, 600, 2100)).toThrow("Own-customer quote rows add up to $2,024.00, not the quote total $2,100.00");
    expect(() => ownCustomerRows(items, 0, 2624.01)).not.toThrow();
    expect(() => ownCustomerRows(items, 600, 2023.995)).not.toThrow();
  });

  test("a quote with no fee or no PIESA line fails closed (the total would not include them)", () => {
    expect(() => ownCustomerRows([items[1]!, items[0]!], 600, 2024)).toThrow("Own-customer quote has no AP_FEE line");
    expect(() => ownCustomerRows([items[1]!, items[2]!], 600, 2024)).toThrow("Own-customer quote has no PIESA line");
    expect(() => ownCustomerRows([...items, items[2]!], 600, 2024)).toThrow("Own-customer quote has more than one AP_FEE line");
    expect(() => ownCustomerRows([...items, items[0]!], 600, 2024)).toThrow("Own-customer quote has more than one PIESA line");
  });

  test("a rebate of 0 still shows the Rebate line at 0, never a negative zero", () => {
    const r = ownCustomerRows(items, 0, 2624);
    const rebate = r.find((x) => x.key === "rebate")!;
    expect(rebate.amountIncGst).toBe(0);
    expect(Object.is(rebate.amountIncGst, -0)).toBe(false);
  });

  test("unknown code fails closed", () => {
    expect(() => ownCustomerRows([{ code: "MYSTERY", description: "?", line_total_inc_gst: 1 }], 0, 1)).toThrow("Unknown own-customer quote line: MYSTERY");
    expect(() => ownCustomerRows([{ code: null, description: "?", line_total_inc_gst: 1 }], 0, 1)).toThrow("Unknown own-customer quote line: null");
    expect(() => ownCustomerRows([{ code: "R5_BATTS", description: "Earthwool R5", line_total_inc_gst: 1 }], 0, 1)).toThrow("Unknown own-customer quote line: R5_BATTS");
  });

  test("an insulation line is required — rows without one fail closed", () => {
    expect(() => ownCustomerRows([items[0]!, items[2]!], 600, 24)).toThrow("Own-customer quote has no INSTALLER_PRICE line");
  });

  test("two insulation lines fail closed", () => {
    expect(() => ownCustomerRows([...items, items[1]!], 600, 4024)).toThrow("Own-customer quote has more than one INSTALLER_PRICE line");
  });

  test("the AP fee is the fixed $349; there is no fixed PIESA constant any more (Jo 4 Nov 2026)", async () => {
    expect(OWN_CUSTOMER_AP_FEE_INC_GST).toBe(349);
    expect(MITTI_INSTALLER_FEE_INC_GST).toBe(349);
    const mod = await import("../src/lib/own-customer-price.core");
    expect("OWN_CUSTOMER_PIESA_INC_GST" in mod).toBe(false);
    expect(PIESA_PRICE_NOT_SET).toBe("Your PIESA price isn't set yet. Ask the office to add it, then send."); // controller 4 Nov 2026: office-managed rate card
    expect(PIESA_PRICE_NOT_SET).not.toMatch(/pay|paid|\$/i);
  });

  test("labels are the approved ones, verbatim", () => {
    expect(OWN_CUSTOMER_LABELS).toEqual({
      insulation: "Insulation",
      apFee: "Home Insulation Victoria fee",
      piesa: "Electrical safety check (PIESA) — charged by Home Insulation Victoria",
      rebate: "Rebate",
      total: "Your price",
    });
  });

  test("does not mutate the items it is given", () => {
    const copy = items.map((i) => ({ ...i }));
    ownCustomerRows(copy, 600, 2024);
    expect(copy).toEqual(items);
  });
});

describe("Home Insulation Victoria leads are untouched", () => {
  test("the existing quote builder's output is byte-identical to the base commit (242c6c7) with this module loaded", () => {
    // Recorded at 242c6c7 before src/lib/own-customer-price.core.ts existed. Task 1 adds a new pure module only:
    // the existing builder (used for Home Insulation Victoria leads and own customers alike) must emit exactly this.
    const input: Parameters<typeof buildInstallerQuoteDraft>[0] = {
      price: { ok: true, issues: [], price: { totalIncGst: 2000, included: ["Supply", "Install"], otherDescription: "", agreedWithOwner: true } },
      measuredM2: 120,
      wholeVeec: { veecs: 10, raw: 600 },
      piesaIncGst: 349,
      apFeeIncGst: 349,
      caps: { metropolitan: true, minCopay: 200 },
      separateLines: [],
    };
    const recordedAtBase =
      '{"ready":true,"blockers":[],"lines":[{"code":"INSTALLER_PRICE","description":"Insulation works by your installer — includes: Supply, Install","quantity":1,"unit":"flat","unit_price_inc_gst":2000,"line_total_inc_gst":2000,"is_other":false,"explanation":"Supply\\nInstall","sort":0},{"code":"PIESA","description":"Mandatory Pre Insulation Electrical Safety Assessment (PIESA)","quantity":1,"unit":"flat","unit_price_inc_gst":349,"line_total_inc_gst":349,"is_other":false,"explanation":null,"sort":1},{"code":"AP_FEE","description":"Home Insulation Victoria — Accredited Person fee","quantity":1,"unit":"flat","unit_price_inc_gst":349,"line_total_inc_gst":349,"is_other":false,"explanation":null,"sort":2}],"subtotal":2698,"discount":600,"afterDiscount":2098,"discountNote":null}';
    expect(typeof ownCustomerRows).toBe("function");
    expect(JSON.stringify(buildInstallerQuoteDraft(input))).toBe(recordedAtBase);
  });
});
