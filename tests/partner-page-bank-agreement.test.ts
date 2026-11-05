import { describe, expect, test } from "bun:test";
import { agreementPdfText, agreementRowState, bankChangedLine } from "../src/lib/office-partners.core";


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

describe("agreement PDF", () => {
  const a = { version: "v2", body: "Agreement text", signer_name: "Sam Lee", signed_at: "2026-10-08T01:00:00Z" };
  test("uses the same wording as the installer page", () => {
    const t = agreementPdfText(a, "Reinsulate");
    expect(t.title).toBe("Home Insulation Victoria partner agreement vv2 - Reinsulate");
    expect(t.body).toMatch(/^Agreement text\n\nSigned by Sam Lee on .* \(Melbourne time\)\.$/);
    expect(t.fileName).toBe("agreement-vv2.pdf");
  });
  test("row opens unless the text is missing", () => {
    expect(agreementRowState(a)).toBe("open");
    expect(agreementRowState({ body: "  " })).toBe("missing");
    expect(agreementRowState({ body: null })).toBe("missing");
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
