import { describe, expect, test } from "bun:test";
import { agreementPdfLink, bankChangedLine } from "../src/lib/office-partners.core";

const biz = "11111111-1111-1111-1111-111111111111";

describe("bank Changed row", () => {
  test("shows date and how, never a review status", () => {
    expect(bankChangedLine("Thu, 8 Oct", "supplied")).toBe("Thu, 8 Oct · supplied");
    expect(bankChangedLine("Thu, 8 Oct", "supplied")).not.toMatch(/pending|approved|rejected/);
  });
  test("handles missing parts", () => {
    expect(bankChangedLine(null, null)).toBe("—");
    expect(bankChangedLine("Thu, 8 Oct", null)).toBe("Thu, 8 Oct");
  });
});

describe("agreement PDF link", () => {
  test("a recorded path in the business's own folder opens", () => {
    expect(agreementPdfLink({ pdfPath: `partners/${biz}/agreement.pdf` }, biz)).toEqual({ path: `partners/${biz}/agreement.pdf` });
  });
  test("no path, another business's path or a traversal path is none", () => {
    expect(agreementPdfLink({ pdfPath: null }, biz)).toEqual({ none: true });
    expect(agreementPdfLink({ pdfPath: "" }, biz)).toEqual({ none: true });
    expect(agreementPdfLink({ pdfPath: "partners/other/agreement.pdf" }, biz)).toEqual({ none: true });
    expect(agreementPdfLink({ pdfPath: `partners/${biz}/../x.pdf` }, biz)).toEqual({ none: true });
  });
});

import { rateCardLine, rateIncGst } from "../src/lib/office-partners.core";
describe("installer rates show inc GST", () => {
  // Reinsulate's stored ex-GST rate card (2dp) and the inc-GST figures Jo expects to see.
  const stored: [string, number, string][] = [
    ["R5", 20.91, "23.00"], ["R6", 23.64, "26.00"], ["R7", 27.27, "30.00"], ["Top-up R5", 20.91, "23.00"],
    ["Batts removal", 11.82, "13.00"], ["Loose-fill removal", 11.82, "13.00"], ["PIESA", 317.27, "349.00"],
  ];
  for (const [name, ex, inc] of stored) test(`${name} ${ex} ex -> $${inc} inc`, () => expect(rateIncGst(ex).toFixed(2)).toBe(inc));
  test("rate card line can show inc GST; default stays ex", () => {
    expect(rateCardLine([{ code: "R5_BATTS", unit_price_ex_gst: 20.91 }], { incGst: true })).toBe("R5.0 batts $23.00/m²");
    expect(rateCardLine([{ code: "R5_BATTS", unit_price_ex_gst: 24.5 }])).toBe("R5.0 batts $24.50/m²");
  });
});
